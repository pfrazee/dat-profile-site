/* globals DatArchive */

const {MissingParameterError} = require('errors')
const CachedFile = require('./cached-file')
const CachedSites = require('./cached-sites')

module.exports = class DatProfileSite {
  constructor (url) {
    if (!url) {
      throw new MissingParameterError()
    }
    this.url = url
    this.archive = new DatArchive(url)

    // managed data
    this.cache = {
      profile: new CachedFile(this.archive, '/profile.json', {json: true}),
      otherSites: new CachedSites(DatProfileSite)
    }
  }

  // profile data
  // =

  async getProfile () {
    try {
      return await this.cache.profile.get()
    } catch (e) {
      console.debug('Failure reading /profile.json. (This may not be a bug.)', e)
      return {}
    }
  }

  async setProfile (updates) {
    // TODO validate updates?

    // read, update, write profile
    var profile = await this.getProfile()
    Object.assign(profile, updates)
    return await this.cache.profile.put(profile)
  }

  // social relationships
  // =

  async follow (url) {
    // TODO validate URL?

    // read, update, write profile
    var profile = await this.getProfile()
    if (!profile.follows.find(byURL(url))) {
      profile.follows.push({url})
    }
    return await this.cache.profile.put(profile)
  }

  async unfollow (url) {
    // read, update, write profile
    var profile = await this.getProfile()
    var index = profile.follows.findIndex(byURL(url))
    if (index !== -1) {
      profile.follows.splice(index, 1)
    }
    return await this.cache.profile.put(profile)
  }

  async listFollowing () {
    // get profile
    var profile = await this.getProfile()
    var follows = profile.follows || []

    // get followed sites
    var followedSites = await this.cache.otherSites.get(follows)

    // fetch profiles
    return await getRemoteProfiles(followedSites)
  }

  async listKnownFollowers () {
    return this.listFriends()
  }

  async listFriends () {
    // get profile
    var profile = await this.getProfile()
    var follows = profile.follows || []

    // get followed sites
    var followedSites = await this.cache.otherSites.get(follows)

    // filter mutual follows
    followedSites = followedSites.filter(site => site.isFollowing(this.url))

    // fetch profiles
    return await getRemoteProfiles(followedSites)
  }

  async isFollowing (url) {
    // get profile
    var profile = await this.getProfile()
    var follows = profile.follows || []

    // find URL
    return !!follows.find(byURL(url))
  }

  async isFriendsWith (url) {
    // get profile
    var profile = await this.getProfile()
    var follows = profile.follows || []

    // find follow
    var follow = follows.find(byURL(url))
    if (!follow) {
      return false
    }

    // load remote profile
    var followedSites = await this.cache.otherSites.get([follow])
    var followedProfiles = await getRemoteProfiles(followedSites)
    var followedProfile = followedProfiles[0]
    var inverseFollows = followedProfile.follows || []

    // find inverse follow
    return !!inverseFollows.find(byURL(this.url))
  }

  // posting to the feed
  // =

  async broadcast ({text, image, video, audio}) {
    // TODO validate?

    // construct broadcast
    var values = {
      '@context': 'http://schema.org',
      '@type': 'Comment'
    }
    if (text) values.text = text
    if (image) values.image = image
    if (video) values.video = video
    if (audio) values.audio = audio

    // write file
    var path = getBroadcastPath('comment')
    await ensureParentDirectoryExists(this.archive, path)
    await this.archive.writeFile(path, JSON.stringify(values, null, 2))
  }

  // reading the feed
  // =

  async listBroadcasts (opts) {
    return buildFeed([this], opts)
  }

  async listFeed (opts) {
    // get followed sites
    var profile = await this.getProfile()
    var followedSites = await this.cache.otherSites.get(profile.follows || [])

    // build the feed
    return buildFeed([this].concat(followedSites), opts)
  }

  async getBroadcast (path) {
    // load entry if needed
    var entry = path
    if (typeof entry === 'string') {
      entry = this.archive.stat(path)
    }

    // read and parse
    entry.content = JSON.parse(await this.archive.readFile(entry.name, 'utf8'))

    return entry
  }

  // events
  // =

  async createActivityStream () {
    // TODO
  }
}

// helper fn for find() and findIndex()
function byURL (v) {
  v = normalizeURL(v)
  return obj => normalizeURL(obj.url) === v
}

// helper to load the profiles of multiple remote sites, simultaneously
async function getRemoteProfiles (profileSites) {
  return await Promise.all(profileSites.map(async (profileSite) => {
    try {
      // fetch profile and note that download was successful
      var profile = await profileSite.cache.profile.get()
      profile.url = profileSite.url
      profile.downloaded = true
      return profile
    } catch (e) {
      if (e.name === 'TimeoutError') {
        // download failure
        return {
          url: profileSite.url,
          downloaded: false
        }
      }
      // other failure
      return {
        url: profileSite.url,
        downloaded: true
      }
    }
  }))
}

// helper to ensure a target directory is available
async function ensureParentDirectoryExists (archive, path) {
  var pathParts = path.split('/').slice(0, -1) // drop the filename
  for (var i = 1; i <= pathParts.length; i++) {
    try { await archive.createDirectory(pathParts.slice(0, i).join('/')) } catch (e) { console.debug(e) }
  }
}

// helper to construct post destinations
function getBroadcastPath (type) {
  var d = new Date()
  var YYYY = d.getFullYear()
  var MM = pad0(d.getMonth() + 1)
  var DD = pad0(d.getDate())
  var hh = pad0(d.getHours())
  var mm = pad0(d.getMinutes())
  var ss = pad0(d.getSeconds())
  return `/broadcasts/${YYYY}/${MM}/${DD}/${type}-${hh}${mm}${ss}.json`
}

// helper to make sure 1 -> 01, but 11 -> 11
function pad0 (v) {
  v = '' + v
  if (v.length === 1) {
    return '0' + v
  }
  return v
}

// helper to construct a feed from an arbitrary set of sites
async function buildFeed (sites, {after, before, limit, metaOnly, type, reverse} = {}) {
  var feed = []
  if (before) before = +before
  if (after) after = +after
  limit = limit || 20

  sites.forEach(async site => {
    try {
      // list files
      var entries = await site.archive.listFiles('/broadcasts')
    } catch (e) {
      return []
    }

    // parse and filter
    Object.keys(entries).filter(name => {
      // parse create time
      var createTime = parseBroadcastFilename(name)

      // filter
      if (!createTime) return
      if (after && createTime <= after) return
      if (before && createTime >= before) return

      // add to feed
      entries[name].author = site
      feed.push(entries[name])
    })
  })

  // sort
  if (reverse) {
    feed.sort((a, b) => a.ctime - b.ctime)
  } else {
    feed.sort((a, b) => b.ctime - a.ctime)
  }

  // limit
  if (limit) {
    feed = feed.slice(0, limit)
  }

  // early finishing condition
  if (metaOnly) {
    return feed
  }

  // read files
  await Promise.all(feed.map(async (entry) => {
    try {
      // read and parse
      entry.content = JSON.parse(await entry.author.archive.readFile(entry.name, 'utf8'))
    } catch (e) {
      console.warn('Failed to read file', e)
      entry.error = e
      entry.content = null
    }
  }))
  if (type) {
    // apply type filter
    return feed.filter(entry => {
      return !!entry.content && entry.content.type.toLowerString() === type.toLowerString()
    })
  }
  return feed
}

// helper to pull the timestamp from the broadcast filenames
var bfregex = /\/([\d]+)\.json$/i
function parseBroadcastFilename (path) {
  var match = bfregex.exec(path)
  if (match) return +match[1]
  return false
}

var urlregex = /(dat:\/\/[^/]*)/i
function normalizeURL (url) {
  var match = urlregex.exec(url)
  if (match) return match[1]
  return false
}
