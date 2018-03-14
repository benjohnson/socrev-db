const fs = require('fs')
const algoliasearch = require('algoliasearch')
const chunk = require('lodash.chunk')

let client, index
let errors = []

const grabText = str => {
  // remove html and other junk from text
  let result = ''
  const regex = /(<([^>]+)>)/gi
  result = str.replace(regex, '') // html
  result = result.replace(/\n/g, ' ') // new lines
  result = result.replace(/[&]nbsp[;]/gi, ' ') // nbsp
  result = result.replace(/\s\s+/g, ' ') // multiple spaces
  result = result.trim() // trailing spaces
  return result
}

const modPosts = posts => {
  // mod posts to get them ready for algolia
  let undefinedAcfs = []
  let undefinedAuthors = []
  let undefinedExcerpts = []
  let undefinedDates = []
  return posts.map(d => {
    let result = {
      id: d.id,
      date: d.date,
      modified: d.modified,
      slug: d.slug,
      status: d.status,
      title: d.title.rendered,
      //content: d.content.rendered,
      content: '',
      excerpt: d.excerpt.rendered,
      //author: d.acf.imt_author,
      author: '',
      categories: [],
    }
    // grab text from content
    result.content = grabText(d.content.rendered)

    d.categories.forEach(cat => {
      // removing uncategorized from categories
      if (cat.name !== 'Uncategorized') {
        result.categories.push(cat)
      }
    })

    if (d.acf !== undefined) {
      if (d.acf.imt_author !== undefined) {
        if (d.acf.imt_author.length > 0) result.author = d.acf.imt_author
      } else {
        //console.log(`${result.id}: ${result.title} has undefined acf.imt_author`)
        undefinedAuthors.push(result)
      }
      if (d.acf.imt_excerpt !== undefined) {
        if (d.acf.imt_excerpt.length > 0)
          //console.log(`${result.id}: ${result.title} has imt_excerpt`)
          result.excerpt = d.acf.imt_excerpt
      } else {
        //console.log(`${result.id}: ${result.title} has undefined acf.imt_excerpt`)
        undefinedExcerpts.push(result)
      }
      if (d.acf.imt_date !== undefined) {
        /*
        if (d.acf.imt_date.length > 0)
          console.log(
            `${result.id}: ${result.slug} has imt_date ${
              d.acf.imt_date
            } and date ${result.date}`
          )
        */
      } else {
        //console.log(`${result.id}: ${result.title} has undefined acf.imt_date`)
        undefinedDates.push(result)
      }
    } else {
      //console.log(`${result.id}: ${result.title} has undefined acf`)
      undefinedAcfs.push(result)
    }

    // grab text from excerpt
    result.excerpt = grabText(d.excerpt.rendered)

    return result
  })
  console.log(`${undefinedAcfs.length} undefined acfs`)
  console.log(`${undefinedAuthors.length} undefined authors`)
  console.log(`${undefinedExcerpts.length} undefined excerpts`)
  console.log(`${undefinedDates.length} undefined dates`)
}

const splitPosts = posts => {
  // ensure all posts are under 10k bytes
  let results = []
  posts.forEach(p => {
    const maxByteSize = 10000
    const content = [...p.content]
    delete p.content
    p.objectID = `${`${p.id}`.padStart(4, '0')}-999-999`

    let postOtherBytes = Buffer.byteLength(JSON.stringify(p), 'utf8')
    //console.log(`> ${p.id}: post ${postOtherBytes}`)
    const add = 11 // content byte size is off by 11

    let contentBytes = 0
    let splits = []
    content.forEach((entry, i) => {
      const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8') + add
      const currentSize = postOtherBytes + contentBytes + bytes
      if (currentSize < maxByteSize) {
        contentBytes += bytes
      } else {
        // this post has reached max size
        splits.push(i)
        //console.log(`> ${p.id}:${splits.length} size ${postOtherBytes + contentBytes}`)
        // aggregate bytes of each content entry starting with the current
        contentBytes = bytes
      }
    })
    splits.push(content.length)
    splits.forEach((splitIndex, i, arr) => {
      const prevSplit = i - 1 < 0 ? 0 : arr[i - 1]
      //console.log(`splits: current ${splitIndex} previous ${prevSplit}`)
      let newPost = Object.assign({}, p)
      const pb = Buffer.byteLength(JSON.stringify(p), 'utf8')
      const newContent = content.slice(prevSplit, splitIndex)
      const cb = Buffer.byteLength(JSON.stringify(newContent), 'utf8')
      const calcSize = pb + cb + add
      newPost.content = newContent
      const realSize = Buffer.byteLength(JSON.stringify(newPost), 'utf8')
      newPost.objectID = `${`${newPost.id}`.padStart(4, '0')}-${`${i +
        1}`.padStart(3, '0')}-${`${splits.length}`.padStart(3, '0')}` // match algolia's objectID with our id
      if (calcSize !== realSize) {
        console.log(`calc: ${pb} + ${cb} = ${calcSize}`)
        console.log(`real: ${realSize}`)
        console.log(`diff ${Math.abs(realSize - calcSize)}`)
      }
      results.push(newPost)
    })
  })
  return results
}

const sendPost = (post, ind) => {
  return new Promise((resolve, reject) => {
    index.addObject(post, (errA, content) => {
      if (errA) {
        // post size errors show up here
        if (!errors.includes(post.id)) errors.push(post.id)
        return reject(
          `${post.id}: ${errA.message.replace('the position 0', ind)}`
        )
      }
      index.waitTask(content.taskID, errB => {
        if (errB) return reject(`${post.id}: ${errB.message}`)
        console.log(`> ${post.id}: ${ind} indexed at ${content.objectID}`)
        resolve()
      })
    })
  })
}

const sendPosts = posts => {
  /*
  const chunks = chunk(posts, 1000)
  chunks.map(batch => index.addObjects(batch))
  */
  console.log(`> sending ${posts.length} new records to algolia`)
  return new Promise((resolve, reject) => {
    index.addObjects(posts, (errAdd, content) => {
      if (errAdd) return reject(errAdd)
      index.waitTask(content.taskID, errWait => {
        if (errWait) return reject(`${post.id}: ${errWait.message}`)
        console.log(`> ${post.id}: ${ind} indexed at ${content.objectID}`)
        resolve(content)
      })
    })
  })
}

module.exports = function(id, key) {
  client = algoliasearch(id, key)
  index = client.initIndex('posts')
  return {
    initIndex: () => {
      // set settings after index creation
      index.setSettings(
        {
          searchableAttributes: [
            'slug',
            'title',
            'categories',
            'tags',
            'excerpt',
            'content',
            'author',
            'date',
            'modified',
          ],
          typoTolerance: 'min',
          attributeForDistinct: 'id',
          distinct: 1,
        },
        function(err, content) {
          console.log(content)
        }
      )
    },
    getAll: () => {
      // returns latest from algolia
      return new Promise((resolve, reject) => {
        const browser = index.browseAll()
        let hits = []
        browser.on('result', function onResult(content) {
          hits = hits.concat(content.hits)
        })
        browser.on('end', function onEnd() {
          resolve(hits)
        })
        browser.on('error', function onError(err) {
          reject(err)
        })
      })
    },
    deletePosts: ids => {
      return new Promise((resolve, reject) => {
        index.deleteObjects(ids, (err, content) => {
          resolve(content)
        })
      })
    },
    splitPosts,
    sendPost,
    handleUpdates: async posts => {
      // recieves/modifies/splits posts, sends to algolia
      //console.log(`applying algolia post modification to ${posts.length} posts`)
      //posts = modPosts(posts)

      // algolia will get posts starting with oldest of newest db posts
      posts.sort((a, b) => a.modified - b.modified)

      console.log(`> applying algolia split to ${posts.length} posts`)
      posts = splitPosts(posts)

      /*
      let promises = []
      posts.forEach(async (d, i) => {
        promises.push(sendPost(d, i))
      })
      await Promise.all(promises)
      */

      for (let i = 0; i < posts.length; i++) {
        await sendPost(posts[i], i).catch(console.error)
        //if(errors.length > 0)
      }
      console.log(`errors: ${errors.length}`)
      errors.forEach(console.error)

      return errors
      //await sendPosts(posts)

      /*
      fs.writeFileSync(
        '/Users/joshua/projects/imt/algoliaerrors.json',
        JSON.stringify(errors)
      )
      */
    },
  }
}
