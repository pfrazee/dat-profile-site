module.exports = class CachedSites {
  constructor (DatProfileSite) {
    this.DatProfileSite = DatProfileSite
    this.sites = {}
  }

  get (descriptors) {
    return descriptors.map(d => {
      if (d.url in this.sites) {
        return this.sites[d.url]
      }
      this.sites[d.url] = new (this.DatProfileSite)(d.url)
      return this.sites[d.url]
    })
  }
}
