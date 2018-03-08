const app = require('express')()
const http = require('http').Server(app)
const bodyParser = require('body-parser')
let io = require('socket.io')
const cors = require('cors')
const MongoClient = require('mongodb').MongoClient
const Long = require('mongodb').Long
const dotenv = require('dotenv')
const fs = require('fs')
const fetch = require('isomorphic-unfetch')

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

app.use(cors())
app.use(bodyParser.json())

const loadData = (arr, collection) => {
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

const updateSearch = async postsCollection => {
  // synchronize algolia with db
  console.log('> checking if algolia needs updates...')
  const getSearchUpdates = async dateStr => {
    // get all posts from db that are newer than latest in algolia
    const cursor = await postsCollection.find({ modified: { $gt: dateStr } })
    let records = []
    while (await cursor.hasNext()) records.push(await cursor.next())
    return await Promise.all(records)
  }

  // get everything from algolia
  let hits = await search.getAll()
  console.log(`> algolia collection length: ${hits.length}`)
  hits = hits.sort((a, b) => {
    const aDate = new Date(a.modified).getTime()
    const bDate = new Date(b.modified).getTime()
    return bDate - aDate
  })
  // get latest algolia date
  const algoliaLatest = hits[0].modified
  console.log(`> latest in algolia: ${algoliaLatest}`)
  // get db posts that are newer than algolia
  const newPosts = await getSearchUpdates(algoliaLatest)
  console.log(`> posts newer than algolia: ${newPosts.length}`)
  if (newPosts.length > 0) {
    // collect associated algolia objectIDs
    const objectIDs = []
    hits.forEach(d => {
      if (newPosts.map(p => p.id).includes(d.id)) {
        objectIDs.push(d.objectID)
      }
    })
    // delete associated algolia records
    const deleteResponse = await search.deletePosts(objectIDs)
    console.log(`> deleted associated algolia records: ${objectIDs.length}`)
    console.log(deleteResponse)
    // modify/split posts, send to algolia
    await search.handleUpdates(newPosts)
    console.log('> search updated')
  } else console.log(`> algolia is already synchronized`)
}
let searchTimeout
const scheduleSearch = postsCollection => {
  const searchTimer = 1000 * 60 * 3 // 3mins
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(async () => {
    await updateSearch(postsCollection)
  }, searchTimer)
}

async function main() {
  /* creates client and connects to database
   * connects to or creates collections
   * attempts to populate collections if empty
   *   fails if associated URLs are inaccessible
   * creates endpoints to make mongo data accessible
   * initializes websocket connection for socrev-api
   */
  const cNames = ['posts', 'cats']
  const toTestCollections = process.env.TEST_COLLECTIONS === '1' ? true : false // use posts-test and cats-test?
  let client
  let db
  let collections = {}
  try {
    client = await MongoClient.connect(url, { poolSize: 10 })
    db = client.db(dbName)
    console.log(`> connected to ${url}`)
    if (toTestCollections) console.log('> using test collections')
    // create collection for each name
    const postsName = toTestCollections ? `posts-test` : 'posts'
    //collections[d] = db.collection(cName)
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
    collections['posts'] = await db.createCollection(postsName, {
      validator: { $and: schemaProps },
      //validator: { $or: schemaProps },
    })
    const catsName = toTestCollections ? `cats-test` : 'cats'
    collections['cats'] = await db.createCollection(catsName)

    let promises = cNames.map(async cName => {
      // load data for each collection if empty and if data URL works
      const collection = collections[cName]
      const count = await collection.count()
      if (count === 0) {
        try {
          const dataUrl = process.env[`${cName.toUpperCase()}_URL`]
          console.log(
            `> ${cName} is empty, will attempt to populate with data from ${dataUrl}`
          )
          const r = await fetch(dataUrl)
          const data = await r.json()
          await loadData(data, collection)
        } catch (e) {
          if (e.name === 'FetchError')
            console.log(
              `> unable to fetch json, will start with empty ${cName} collection`
            )
          else if (e.name === 'TypeError')
            console.log(
              `> can't find process.env.${cName.toUpperCase()}_URL (check .env)`
            )
          else console.log(e)
        }
      } else console.log(`> ${cName} already contains ${count} docs`)
    })
    await Promise.all(promises)
  } catch (e) {
    console.log(e)
  } finally {
    if (client !== undefined) {
      // mongo data is ready, sync algolia
      //await updateSearch(collections.posts)

      // setup REST endpoints
      app.get('/latest', async (req, res) => {
        // provide db's lastest from each collection to socrev-cms
        // returns latest post and all categories
        // requested by cms to determine updates
        let promises = cNames.map(async cName => {
          let result = {}
          const collection = collections[cName]
          let cursor, record
          if (cName === 'cats') {
            cursor = await collection.find()
            record = []
            while (await cursor.hasNext()) record.push(await cursor.next())
            await Promise.all(record)
          } else {
            cursor = await collection
              .find()
              .sort({ modified: -1 })
              .limit(1)
            record = (await cursor.hasNext()) ? await cursor.next() : null
          }
          result[cName] = record
          return result
        })
        const results = await Promise.all(promises)
        //const result = { ...results[0], ...results[1] }
        let result = {}
        results.forEach(
          d => (result[Object.keys(d)[0]] = Object.values(d)[0] || {})
        )
        res.json(result)
      })
      app.post('/update', async (req, res) => {
        // either updates or creates record in mongo
        console.log(`> received ${req.body.type} update`)
        const collection = collections[`${req.body.type}`]
        req.body.element.date = Long.fromString(`${req.body.element.date}`)
        req.body.element.modified = Long.fromString(
          `${req.body.element.modified}`
        )
        const replaceResponse = await collection.findOneAndReplace(
          { id: req.body.element.id },
          req.body.element,
          { upsert: true }
        )
        const dbUpdateSuccess = replaceResponse.ok === 1 ? true : false

        // TODO update API

        //scheduleSearch(collections.posts)

        if (dbUpdateSuccess) {
          res.sendStatus(200)
          return
        }

        console.log(
          `> error upserting post ${req.body.element.id} into ${req.body.type}`
        )
        res.sendStatus(404)
      })
      app.post('/updates', async (req, res) => {
        // delete and replace collection
        // cms calls when updating categories
        const collection = collections[`${req.body.type}`]
        console.log(`> dropping all records from ${req.body.type}`)
        await collection.deleteMany()
        console.log(
          `> inserting ${req.body.element.length} documents into ${
            req.body.type
          }`
        )
        const insertResponse = await collection.insertMany(req.body.element)

        // TODO update API

        if (insertResponse.result.ok === 1) res.sendStatus(200)
        else res.sendStatus(500)
      })
      app.get('/slug', async (req, res) => {
        // returns an article slug (given an id)
        const id = !isNaN(req.query.id) ? parseInt(req.query.id) : null
        if (id === null) {
          res.status(400).send(`bad request (non-number id: ${req.query.id})`)
          return
        }
        const collection = db.collection('redirects')
        const response = await collection.findOne({ old: id })
        console.log(response)
        res.send(response)
      })
      const server = app.listen(port, () =>
        console.log(`> ready on ${server.address().port}`)
      )

      // setup websocket connection to socrev-api
      io = io.listen(server)
      io.on('connection', async socket => {
        console.log(
          //`${`API client connected:`.padEnd(25, ' ')}${socket.client.id}`
          `${socket.client.id} connected`
        )
        socket.on('init', async (msg, fn) => {
          // send all collection data when an api instance connects to init
          console.log(`${socket.client.id} init received, sending data`)
          // create initResult object
          let promises = cNames.map(async cName => {
            let result = {}
            const collection = collections[cName]
            const cursor = await collection.find()
            let records = []
            while (await cursor.hasNext()) records.push(await cursor.next())
            await Promise.all(records)
            result[cName] = records
            return result
          })
          const results = await Promise.all(promises)
          let initResult = {}
          results.forEach(
            d => (initResult[Object.keys(d)[0]] = Object.values(d)[0] || {})
          )
          return fn(initResult)
        })
        socket.on('disconnect', () =>
          console.log(
            //`${`API client disconnected:`.padEnd(25, ' ')}${socket.client.id}`
            `${socket.client.id} disconnected`
          )
        )
      })

      /*
      console.log('closing mongo connection')
      await client.close()
      */
    }
  }
}
main()
