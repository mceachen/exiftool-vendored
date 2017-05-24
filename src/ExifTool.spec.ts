import { expect } from "./chai.spec"
import { ExifTool } from "./ExifTool"
import * as _path from "path"
import * as semver from "semver"

describe("ExifTool", () => {
  const exiftool = new ExifTool(2)
  const truncated = _path.join(__dirname, "..", "test", "truncated.jpg")
  const noexif = _path.join(__dirname, "..", "test", "noexif.jpg")
  const img = _path.join(__dirname, "..", "test", "img.jpg")

  function runningProcs(): number {
    return exiftool["batchCluster"].pids.length
  }

  const packageJson = require("../package.json")

  function expectedExiftoolVersion(): string {
    const linuxVendorVersion = packageJson.optionalDependencies["exiftool-vendored.pl"]
    const major = semver.major(linuxVendorVersion)
    const minor = semver.minor(linuxVendorVersion)
    expect(major).to.be.gte(10)
    expect(minor).to.be.gte(46)
    return `${major}.${minor}`
  }

  it("returns the correct version", async function () {
    this.slow(500)
    return expect(await exiftool.version()).to.eql(expectedExiftoolVersion())
  })

  it("returns expected results for a given file", async function () {
    this.slow(500)
    return expect(exiftool.read(img).then(tags => tags.Model)).to.eventually.eql("iPhone 7 Plus")
  })

  it("Renders Orientation as strings normally", async () => {
    const tags = await exiftool.read(img)
    return expect(tags.Orientation).to.eql("Horizontal (normal)")
  })

  it("Renders Orientation as a number when specified", async () => {
    const tags = await exiftool.read(img, ["-Orientation#"])
    return expect(tags.Orientation).to.eql(1)
  })

  it("returns warning for a truncated file", () => {
    return expect(exiftool.read(truncated).then(tags => tags.Warning)).to.eventually.eql("JPEG format error")
  })

  function normalize(tagNames: string[]): string[] {
    return tagNames.filter(i => i !== "FileInodeChangeDate" && i !== "FileCreateDate").sort()
  }

  it("returns no exif metadata for an image with no headers", () => {
    return expect(exiftool.read(noexif).then(tags => normalize(Object.keys(tags)))).to.become(normalize([
      "BitsPerSample",
      "ColorComponents",
      "Directory",
      "EncodingProcess",
      "ExifToolVersion",
      "FileAccessDate",
      "FileModifyDate",
      "FileName",
      "FilePermissions",
      "FileSize",
      "FileType",
      "FileTypeExtension",
      "ImageHeight",
      "ImageSize",
      "ImageWidth",
      "Megapixels",
      "MIMEType",
      "SourceFile",
      "YCbCrSubSampling",
      "errors"
    ]))
  })

  it("returns error for missing file", () => {
    return expect(exiftool.read("bogus")).to.eventually.be.rejectedWith(/File not found/)
  })

  it("sets \"Error\" for unsupported file types", async () => {
    return expect((await exiftool.read(__filename)).Error).to.match(/Unknown file type/i)
  })

  it("ends with multiple procs",async function () {
    this.slow(500)
    const promises = [exiftool.read(img), exiftool.read(img), exiftool.read(img)]
    expect(runningProcs()).to.eql(2)
    const tags = await Promise.all(promises)
    tags.forEach(t => expect(t).to.not.be.undefined)
    await exiftool.end()
    return expect(runningProcs()).to.eql(0)
  })
})
