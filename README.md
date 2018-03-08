Connects to (or creates) mongo collections, and then listens for updates to apply to the data.
Also, this app can connect to algolia (if given an account) and keep an associated collection in sync.

## Startup

A `.env` is needed, example below:

```
PORT=3001
MONGO_HOST=       # required
MONGO_DB=         # required
MONGO_USER=       # required
MONGO_PASSWORD=   # required
ALGOLIA_ID=
ALGOLIA_KEY=
POSTS_URL=http://localhost:5000/posts.json
CATS_URL=http://localhost:5000/cats.json
```

Once the above file is in place, run `npm install && npm start`.

## Steps

The following steps take place:

1.  A connection to a mongo instance is attempted at a URL generated from the given environment details.
2.  Two collections are either connected to or created: `posts` and `cats`.
3.  If the `posts` collection is empty, then `POSTS_URL` is used to retrieve a JSON file with an array of documents to upload to the collection.
4.  Connects to algolia to synchronize between the mongo collection and algolia data (based on `modified` document property).
5.  Creates the following endpoints:
    * GET `/latest`: used by `socrev-cms` to determine which updates are newer than currently found in mongo (returns latest from `posts` and all from `cats`)
    * POST `/update`: updates (or creates) a mongo record
    * POST `/updates`:

## Remaining tasks

* add security on update endpoints
*
