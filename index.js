const app = require('express')()
const http = require('http').Server(app)
const bodyParser = require('body-parser')
let io = require('socket.io')
const cors = require('cors')
const MongoClient = require('mongodb').MongoClient
const dotenv = require('dotenv')
const fs = require('fs')
const fetch = require('isomorphic-unfetch')

dotenv.config()

const port = process.env.PORT
const muser = encodeURIComponent(process.env.MONGO_USER)
const mpass = encodeURIComponent(process.env.MONGO_PASSWORD)
const authMechanism = 'DEFAULT'
const dbName = 'socrev'
const url = `mongodb://${muser}:${mpass}@ds137256.mlab.com:37256/${dbName}?authMechanism=${authMechanism}`

app.use(cors())
app.use(bodyParser.json())

// import json file from cli:
// mongoimport -h ds137256.mlab.com:37256 -d socrev -c posts -u mongo-admin -p fated-dropkick-shamrock-pinwheel --file posts.json --jsonArray

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

async function main() {
  /* creates client and connects to database
   * connects to or creates collections
   * attempts to populate collections if empty
   *   fails if associated URLs are inaccessible
   */
  const cNames = ['posts', 'cats']
  //const cNames = ['posts', 'songs']
  let client
  let collections = {}
  try {
    client = await MongoClient.connect(url, { poolSize: 10 })
    const db = client.db(dbName)
    cNames.forEach(d => (collections[d] = db.collection(d))) // create collection for each name
    let promises = cNames.map(async cName => {
      // load data for each collection if empty and if data URL works
      const collection = collections[cName]
      const count = await collection.count()
      if (count === 0) {
        try {
          const dataUrl = process.env[`${cName.toUpperCase()}_URL`]
          console.log(
            `${cName} is empty, will attempt to populate with data from ${dataUrl}`
          )
          const r = await fetch(dataUrl)
          const data = await r.json()
          await loadData(data, collection)
        } catch (e) {
          if (e.name === 'FetchError')
            console.log(
              `fetch error, will start with empty ${cName} collection`
            )
          else if (e.name === 'TypeError')
            console.log(
              `can't find process.env.${cName.toUpperCase()}_URL (check .env)`
            )
          else console.log(e)
        }
      } else console.log(`${cName} already contains ${count} docs`)
    })
    await Promise.all(promises)
  } catch (e) {
    console.log(e)
  } finally {
    if (client !== undefined) {
      app.get('/latest', async (req, res) => {
        // provide db's lastest from each collection
        let promises = cNames.map(async cName => {
          let result = {}
          const collection = collections[cName]
          const cursor = await collection
            //.find({}, { _id: 0, id: 1, modified: 1 })
            .find()
            .sort({ modified: -1 })
            .limit(1)
          const record = (await cursor.hasNext()) ? await cursor.next() : null
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
        // send update to mongo
        const collection = collections[`${req.body.type}s`]
        const replaceResponse = await collection.findOneAndReplace(
          { id: req.body.element.id },
          req.body.element
        )
        const dbUpdateSuccess = replaceResponse.lastErrorObject.updatedExisting
        // send update to API
        // TODO should websocket search update happen here also?
        if (dbUpdateSuccess) res.sendStatus(200)
        else res.sendStatus(404)
      })
      const server = app.listen(port, () =>
        console.log(`> ready on ${server.address().port}`)
      )
      io = io.listen(server)
      io.on('connection', async socket => {
        // send all collection data when an api instance connects to init
        console.log('API client connected')
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
        let result = {}
        results.forEach(
          d => (result[Object.keys(d)[0]] = Object.values(d)[0] || {})
        )
        socket.emit('init', result)
        socket.on('disconnect', () => {
          console.log('user disconnected')
        })
      })

      /*
      console.log('closing mongo connection')
      await client.close()
      */
    }
  }
}
main()
