const MongoClient = require('mongodb').MongoClient
const dotenv = require('dotenv')

dotenv.config()

const port = process.env.PORT
const muser = encodeURIComponent(process.env.MONGO_USER)
const mpass = encodeURIComponent(process.env.MONGO_PASSWORD)
const algoliaId = process.env.ALGOLIA_ID
const algoliaKey = process.env.ALGOLIA_KEY
const authMechanism = 'DEFAULT'
const mongoHost = process.env.MONGO_HOST
const dbName = process.env.MONGO_DB
const url =
  process.env.MONGO_IS_LOCAL === '1'
    ? `mongodb://localhost:27017/${dbName}`
    : `mongodb://${muser}:${mpass}@${mongoHost}/${dbName}?authMechanism=${authMechanism}`

const search = require('./src/algolia')(algoliaId, algoliaKey)

const main = async () => {
  const id = 307 // 2217 307 1899
  client = await MongoClient.connect(url).catch(console.error)
  db = client.db(dbName)
  post = await db
    .collection('posts')
    .findOne({ id })
    .catch(console.error)
  if (post === null) return console.log(`${id} returned null`)
  const splits = search.splitPosts([post])
  console.log(`splits ${splits.length}`)

  for (let i = 0; i < splits.length; i++) {
    //await search.sendPost(splits[i], i).catch(console.error)
    console.log(Buffer.byteLength(JSON.stringify(splits[i]), 'utf8'))
  }
}

main()
