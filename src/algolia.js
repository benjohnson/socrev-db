const algoliasearch = require('algoliasearch')
//const chunk = require('lodash.chunk')

let client, index

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
    const maxByteSize = 5000
    let bytes = Buffer.byteLength(JSON.stringify(p), 'utf8')
    let numOfSplits = Math.floor(bytes / maxByteSize) // number of splits
    let spaceIndices = [] // all space indices
    p.content
      .split('')
      .forEach((d, i) => (d === ' ' ? spaceIndices.push(i) : null))
    let splitLength = p.content.length / numOfSplits // equal content length
    let spaceSplits = [0]
    const closest = (num, arr) => {
      // https://stackoverflow.com/questions/8584902/get-closest-number-out-of-array#8584940
      let mid
      let lo = 0
      let hi = arr.length - 1
      while (hi - lo > 1) {
        mid = Math.floor((lo + hi) / 2)
        if (arr[mid] < num) lo = mid
        else hi = mid
      }
      if (num - arr[lo] <= arr[hi] - num) return arr[lo]
      return arr[hi]
    }
    for (let i = 0; i < numOfSplits; i++) {
      // for number of needed splits
      let result = JSON.parse(JSON.stringify(p)) // create post copy
      let length
      if (i + 1 === numOfSplits)
        length = spaceSplits.push(p.content.length) // content length on last iteration
      else
        length = spaceSplits.push(closest(splitLength * (i + 1), spaceIndices))
      result.content = p.content
        .substring(spaceSplits[length - 2], spaceSplits[length - 1])
        .trim()
      results.push(result)
    }
  })
  return results
}

const sendPost = (post, ind) => {
  return new Promise((resolve, reject) => {
    index.addObject(post, (errA, content) => {
      if (errA) {
        // past errors were caused exclusively due to post size
        errors.push(ind)
        resolve()
        console.log(
          `${post.id}: ${errA.message.replace('the position 0', ind)}`
        )
        return
      }
      index.waitTask(content.taskID, errB => {
        if (errB) {
          console.log(`${post.id}: ${errB.message}`)
          resolve()
          return
        }
        console.log(`${post.id}: ${ind} indexed at ${content.objectID}`)
        resolve()
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
            //'categories',
            'excerpt',
            'content',
            'author',
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
    handleUpdates: async posts => {
      // recieves/modifies/splits posts, sends to algolia
      console.log(`applying algolia post modification to ${posts.length} posts`)
      posts = modPosts(posts)
      console.log(`applying algolia split to ${posts.length} posts`)
      posts = splitPosts(posts)
      console.log(`sending ${posts.length} new records to algolia`)
      let promises = []
      posts.forEach((d, i) => {
        promises.push(sendPost(d, i))
      })
      await Promise.all(promises)
    },
  }
}

/*
const sendPosts = posts => {
  const chunks = chunk(posts, 500)
  chunks.map(batch => index.addObjects(batch))
}
*/
