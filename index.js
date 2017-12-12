const app = require('express')()
const http = require('http').Server(app)
const io = require('socket.io')(http)
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
//app.use(bodyParser.json())

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
const update = (client, data, collectionName) => {
  // update data within a collection
}

async function main() {
  /* creates client and connects to database
   * connects to or creates collections
   * attempts to populate collections if empty
   *   fails if associated URLs are inaccessible
   */
  const cNames = ['posts', 'cats']
  let client
  try {
    client = await MongoClient.connect(url)
    const db = client.db(dbName)
    let promises = cNames.map(async cName => {
      const collection = db.collection(cName)
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
      console.log(
        'get records with latest modified date, make available to cmsCtrl, listen for updates from cmsCtrl'
      )
      app.get('/latest', async (req, res) => {
        let result = {
          post: '',
          cat: '',
        }
      })
      // find latest update in db
      // dbCtrl will send all posts to each api instance when an api instance starts
      // this can be split up into chunks of data if needed so it isn't too big
      /*
      io.on('connection', socket => {
        console.log('client connected')
        socket.emit('init', {
          posts,
          categories,
        })
      })

      const server = app.listen(port, () =>
        console.log(`> ready on ${server.address().port}`)
      )
      */
      console.log('closing mongo connection')
      await client.close()
    }
  }
}
main('songs')
