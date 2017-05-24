import { BinaryExtractionTask } from "./BinaryExtractionTask"
import { ExifToolTask } from "./ExifToolTask"
import { Tags } from "./Tags"
import { TagsTask } from "./TagsTask"
import { VersionTask } from "./VersionTask"
import { BatchCluster } from "batch-cluster"
import * as _child_process from "child_process"
import * as _os from "os"

export { Tags } from "./Tags"
export { ExifDate, ExifTime, ExifDateTime, ExifTimeZoneOffset } from "./DateTime"

const exiftoolPath = _child_process.execSync("npm run -s exiftool-path").toString()

/**
 * Manages delegating calls to a vendored running instance of ExifTool.
 *
 * Instances should be shared: consider using the exported singleton instance of this class, `exiftool`.
 */
export class ExifTool {
  private readonly batchCluster: BatchCluster

  /**
   * @param maxProcs The maximum number of ExifTool child processes to spawn
   * when load merits
   * @param maxTasksPerProcess The maximum number of requests a given ExifTool
   * process will service before being retired
   * @param spawnTimeoutMillis Spawning new ExifTool processes must not take
   * longer than `spawnTimeoutMillis` millis before it times out and a new
   * attempt is made. Be pessimistic here--windows can regularly take several
   * seconds to spin up a process, thanks to antivirus shenanigans. This can't
   * be set to a value less than 100ms.
   * @param taskTimeoutMillis If requests to ExifTool take longer than this,
   * presume the underlying process is dead and we should restart the task. This
   * can't be set to a value less than 10ms, and really should be set to at more
   * than a second unless `taskRetries` is sufficiently large.
   * @param onIdleIntervalMillis An interval timer is scheduled to do periodic
   * maintenance of underlying child processes with this periodicity.
   * @param taskRetries The number of times a task can error or timeout and be
   * retried.
   */
  constructor(
    readonly maxProcs: number = 1,
    readonly maxTasksPerProcess: number = 100,
    readonly spawnTimeoutMillis: number = 20000, // it shouldn't take longer than 5 seconds to spin up. 4x that should be quite conservative.
    readonly taskTimeoutMillis: number = 5000, // tasks should complete in under 250 ms. 20x that should handle swapped procs.
    readonly onIdleIntervalMillis: number = 2000,
    readonly taskRetries: number = 2
  ) {
    this.batchCluster = new BatchCluster({
      processFactory: () => _child_process.execFile(
        exiftoolPath,
        ["-stay_open", "True", "-@", "-"],
        {
          encoding: "utf8",
          timeout: 0,
          env: { LANG: "C" }
        }
      ),
      versionCommand: new VersionTask().command,
      pass: "{ready}",
      fail: "{ready}",
      exitCommand: "\n-stay_open\nFalse\n",
      maxProcs,
      onIdleIntervalMillis,
      spawnTimeoutMillis,
      taskTimeoutMillis,
      maxTasksPerProcess,
      taskRetries
    })
  }

  /**
   * @return a promise holding the version number of the vendored ExifTool
   */
  version(): Promise<string> {
    return this.enqueueTask(new VersionTask())
  }

  /**
   * @return a Promise holding the metadata tags found in `file`.
   */
  read(file: string, args?: string[]): Promise<Tags> {
    return this.enqueueTask(TagsTask.for(file, args))
  }

  /**
   * Extract the low-resolution thumbnail in `path/to/image.jpg`
   * and write it to `path/to/thumbnail.jpg`.
   *
   * Note that these images can be less than .1 megapixels in size.
   *
   * @return a `Promise<void>`. An `Error` is raised if
   * the file could not be read or the output not written.
   */
  extractThumbnail(imageFile: string, thumbnailFile: string): Promise<void> {
    return this.extractBinaryTag("ThumbnailImage", imageFile, thumbnailFile)
  }

  /**
   * Extract the "preview" image in `path/to/image.jpg`
   * and write it to `path/to/preview.jpg`.
   *
   * The size of these images varies widely, and is present in dSLR images.
   * Canon, Fuji, Olympus, and Sony use this tag.
   *
   * @return a `Promise<void>`. An `Error` is raised if
   * the file could not be read or the output not written.
   */
  extractPreview(imageFile: string, previewFile: string): Promise<void> {
    return this.extractBinaryTag("PreviewImage", imageFile, previewFile)
  }

  /**
   * Extract the "JpgFromRaw" image in `path/to/image.jpg`
   * and write it to `path/to/fromRaw.jpg`.
   *
   * This size of these images varies widely, and is not present in all RAW images.
   * Nikon and Panasonic use this tag.
   *
   * @return a `Promise<void>`. An `Error` is raised if
   * the file could not be read or the output not written.
   */
  extractJpgFromRaw(imageFile: string, outputFile: string): Promise<void> {
    return this.extractBinaryTag("JpgFromRaw", imageFile, outputFile)
  }

  /**
   * Extract a given binary value from "tagname" tag associated to `path/to/image.jpg`
   * and write it to `dest` (which cannot exist and whose directory must already exist).
   *
   * @return a `Promise<void>`. An `Error` is raised if
   * the binary output not be written to `dest`.
   */
  extractBinaryTag(tagname: string, src: string, dest: string): Promise<void> {
    return this.enqueueTask(BinaryExtractionTask.for(tagname, src, dest))
  }

  /**
   * Request graceful shut down of any running ExifTool child processes.
   *
   * This may need to be called in `after` or `finally` clauses in tests
   * or scripts for them to exit cleanly.
   */
  end(): Promise<void> {
    return this.batchCluster.end()
  }

  /**
   * `enqueueTask` is not for normal consumption. External code
   * can extend `Task` to add functionality.
   */
  enqueueTask<T>(task: ExifToolTask<T>): Promise<T> {
    return this.batchCluster.enqueueTask(task)
  }
}

/**
 * Use this singleton rather than instantiating new ExifTool instances in order
 * to leverage a single running ExifTool process. As of v3.0, its `maxProcs` is
 * set to the number of CPUs on the current system; no more than `maxProcs`
 * instances of `exiftool` will be spawned.
 *
 * Note that each child process consumes between 10 and 50 MB of RAM. If you
 * have limited system resources you may want to use a smaller `maxProcs` value.
 */
export const exiftool = new ExifTool(_os.cpus().length)
