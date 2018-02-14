const fs = require('fs')
const { URL } = require('url')
const MongoClient = require('mongodb').MongoClient
const dotenv = require('dotenv')

dotenv.config()
const joomlaDataUrl = new URL(
  'file:///Users/joshua/projects/imt/j3_content.json'
)
const newFileUrl = new URL('file:///Users/joshua/projects/imt/jredirects.json')
const errFileUrl = new URL('file:///Users/joshua/projects/imt/jerrors.json')
const muser = encodeURIComponent(process.env.MONGO_USER)
const mpass = encodeURIComponent(process.env.MONGO_PASSWORD)
const authMechanism = 'DEFAULT'
const dbName = 'socrev'
const url = `mongodb://${muser}:${mpass}@ds137256.mlab.com:37256/${dbName}?authMechanism=${authMechanism}`

const loadData = async (arr, collection) => {
  await collection.drop()
  // loads arr to a collection
  const collectionName = collection.s.name
  return new Promise((resolve, reject) => {
    collection.insert(arr, (err, result) => {
      if (err) reject(err)
      console.log(`${arr.length} documents inserted into ${collectionName}`)
      resolve()
    })
  })
}

async function main() {
  let client
  let db
  let collection
  try {
    client = await MongoClient.connect(url, { poolSize: 10 })
    db = client.db(dbName)
    collection = db.collection('posts')
  } catch (e) {
    console.log(e)
  } finally {
    if (client !== undefined) {
      // get joomla data
      const str = fs.readFileSync(joomlaDataUrl, 'utf8')
      const json = JSON.parse(str)
      const table = json.filter(d => d.type === 'table')[0]
      const joomlaData = table.data.filter(d => d.state === '1')

      // create jredirect collection data
      let jRedirects = []
      let jErrors = []

      // create promise for each post
      let promises = joomlaData.map(async (d, i) => {
        //if (i < 50) {
        const oldId = parseInt(d.id)
        const oldSlug = d.alias
        const author = d.created_by_alias
        //const created = new Date(d.created).getTime()
        //const oldCreated = new Date(d.created)
        const oldCreated = d.created

        // find associated entry in posts collection
        const result = await collection.findOne({
          slug: { $regex: `.*${oldSlug}.*` },
          //date: { $date: new Date(oldCreated) },
          //date: oldCreated,
          //date: { $date: oldCreated},
          //date: new Date(d.created),
          status: 'publish',
        })
        if (result === null)
          jErrors.push({ oldId, oldSlug, author, oldCreated })
        else {
          // push new association object to array
          jRedirects.push({
            old: oldId,
            new: result.id,
            author: author,
            slug: result.slug,
          })
        }
        //}
      })
      await Promise.all(promises)
      console.log(`jRedirects count ${jRedirects.length}`)
      console.log(`jErrors count ${jErrors.length}`)

      // write jredirects collection
      await loadData(jRedirects, db.collection('redirects'))
      // close mongo client
      client.close()

      // write files
      fs.writeFileSync(newFileUrl, JSON.stringify(jRedirects))
      fs.writeFileSync(errFileUrl, JSON.stringify(jErrors))
    }
  }
}
main()
