const config = require('./src/config')

const date = new Date('2018-03-11').getTime() // verify all posts after this modified date

const diff = (a1, a2) => {
  const a2Set = new Set(a2.map(d => d.id))
  return a1.filter(d => !a2Set.has(d.id))
}
const sDiff = (a1, a2) => diff(a1, a2).concat(diff(a2, a1))
const logPosts = arr => {
  arr.sort((a, b) => a.id - b.id).forEach(d => {
    let objId = d.objectID !== undefined ? `${d.objectID} ` : ''
    console.log(`> ${`${d.id}`.padStart(5)}: ${objId}${d.title}`)
  })
}

const main = async () => {
  // init config
  const cfg = await config()
  const { db, search } = cfg

  // get cms posts
  const testWpPosts = []

  // transform: cms to db
  const testMongoPosts = []

  // get db posts
  const dbPosts = await db.getNewPosts(date).catch(err => {
    console.error('failed getting db posts')
    console.error(err)
  })
  console.log(`> ${dbPosts.length} db posts`)
  db.close()
  //logPosts(dbPosts.sort((a, b) => a.id - b.id))

  // transform: db to search

  // get search posts
  const searchPosts = await search.getNewPosts(date).catch(err => {
    console.error('failed getting search posts')
    console.error(err)
  })
  console.log(`> ${searchPosts.length} search posts`)
  //logPosts(searchPosts.sort((a, b) => a.id - b.id))

  const diffs = sDiff(dbPosts, searchPosts)
  if (diffs.length > 0) {
    console.error(`> db and search not in sync`)
    if (dbPosts.length > searchPosts.length) {
      console.error(
        `> db has ${dbPosts.length - searchPosts.length} more posts than search`
      )
    } else {
      console.error(
        `> search has ${searchPosts.length - dbPosts.length} more posts than db`
      )
    }
    //logPosts(searchPosts.sort((a, b) => a.id - b.id))
    logPosts(diffs.sort((a, b) => a.id - b.id))
  } else {
    console.log(`> db and search in sync`)
  }

  /*
  if (post === null) return console.log(`${id} returned null`)
  const splits = search.splitPosts([post])
  console.log(`splits ${splits.length}`)

  for (let i = 0; i < splits.length; i++) {
    //await search.sendPost(splits[i], i).catch(console.error)
    console.log(Buffer.byteLength(JSON.stringify(splits[i]), 'utf8'))
  }
  */

  // get search posts
  console.log(`> main end`)
}

main()
