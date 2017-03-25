module.exports = class CachedFile {
  constructor (archive, path, opts) {
    this.archive = archive
    this.path = path
    this.opts = opts || {}

    // cached contents, loaded lazily
    this.contents = null
  }

  async get () {
    // read from cache
    if (this.contents) {
      return this.contents
    }

    // read from disk
    this.contents = await this.archive.readFile(this.path, this.opts)

    // convert
    if (this.opts.json) {
      this.contents = JSON.parse(this.contents)
    }
    return this.contents || this.opts.fallback
  }

  async put (data) {
    // write to cache
    this.contents = data

    // convert
    if (this.opts.json) {
      data = JSON.stringify(data)
    }

    // write to disk
    await this.archive.writeFile(this.path, data)
  }
}
