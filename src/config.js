const MongoClient = require('mongodb').MongoClient
const Long = require('mongodb').Long
const algoliasearch = require('algoliasearch')
const dotenv = require('dotenv')

dotenv.config()

const port = process.env.PORT

// wordpress

// mongo
const muser = encodeURIComponent(process.env.MONGO_USER)
const mpass = encodeURIComponent(process.env.MONGO_PASSWORD)
const authMechanism = 'DEFAULT'
const mongoHost = process.env.MONGO_HOST
const dbName = process.env.MONGO_DB
const url =
  process.env.MONGO_IS_LOCAL === '1'
    ? `mongodb://localhost:27017/${dbName}`
    : `mongodb://${muser}:${mpass}@${mongoHost}/${dbName}?authMechanism=${authMechanism}`

const poolSize = 10 // number of mongo connections
const schemaProps = [
  /*
  { id: { $type: 'int' } },
  { isSticky: { $type: 'boolean' } },
  { slug: { $type: 'string' } },
  { status: { $in: ['publish', 'draft', 'future'] } },
  { categories: { $type: 'array' } },
  { title: { $type: 'string' } },
  */
  { date: { $type: 'long' } },
  { modified: { $type: 'long' } },
  /*
  { authors: { $type: 'array' } },
  { excerpt: { $type: 'string' } },
  { media: { $type: 'string' } },
  { content: { $type: 'array' } },
  { tags: { $type: 'array' } },
  */
]

// algolia
const algoliaId = process.env.ALGOLIA_ID
const algoliaKey = process.env.ALGOLIA_KEY

module.exports = async function() {
  // wordpress
  const getNewWpPosts = async date => {
    // TODO
  }
  const cms = {
    getNewPosts: getNewWpPosts,
  }

  // mongo
  const client = await MongoClient.connect(url, { poolSize }).catch(
    console.error
  )
  const mongoDb = client.db(dbName)
  const posts = await mongoDb.createCollection('posts', {
    validator: { $and: schemaProps },
  })
  const cats = await mongoDb.createCollection('cats')
  const getNewMongoPosts = async date => {
    const cursor = await posts.find({ modified: { $gt: date } })
    let records = []
    while (await cursor.hasNext()) records.push(await cursor.next())
    return await Promise.all(records)
  }
  const closeMongoConnection = () => client.close()
  const db = {
    getNewPosts: getNewMongoPosts,
    close: closeMongoConnection,
  }

  // algolia
  const algoliaClient = algoliasearch(algoliaId, algoliaKey)
  const algoliaIndex = await algoliaClient.initIndex('posts')
  algoliaIndex
    .setSettings(
      {
        searchableAttributes: [
          'slug',
          'title',
          'tags',
          'excerpt',
          'content',
          'author',
          //'categories',
          //'date',
          //'modified',
        ],
        typoTolerance: 'min',
        attributeForDistinct: 'id',
        maxFacetHits: 100,
        distinct: 1,
      }
      /*
    function(err, content) {
      console.log(content)
    }
    */
    )
    .catch(console.error)
  const getNewAlgoliaPosts = async date => {
    const res = await algoliaIndex
      .search({ numericFilters: [`modified > ${date}`] })
      .catch(err => {
        throw new Error(err)
      })
    return res.hits
  }
  const search = {
    // add search interaction functions here
    getNewPosts: getNewAlgoliaPosts,
  }

  console.log('> config initialized')

  return {
    port,
    db,
    search,
  }
}
