const express = require('express');
require('dotenv').config();

const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;

// mongodb
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// middleware
app.use(cors());
app.use(express.json());

// mongodb connection
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.daqctd4.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // Perform actions using the client here
    const db = client.db('zapShiftDB');
    const parcelsCollection = db.collection('parcels');
    // const usersCollection = db.collection('users');

    // parcels API endpoints would go here
    // Get all parcels
    app.get('/parcels', async (req, res) => {
      // get all parcels
      const query = {};
      // check for query parameters
      const { email } = req.query;
      // if email is provided, filter parcels by senderEmail
      if (email) {
        query.senderEmail = email;
      }
      // options for sorting
      const options = {
        // sort by createdAt in descending order
        sort: { createdAt: -1 },
      };
      // if there are query parameters, you can modify the query object accordingly
      // for example, filtering by status, date range, etc.
      const cursor = parcelsCollection.find(query, options);
      const parcels = await cursor.toArray();
      res.send(parcels);
    });

    // Get a single parcel by ID
    app.get('/parcels/:id', async (req, res) => {
      // get the id from the request parameters
      const id = req.params.id;
      // create a query to find the parcel by its ObjectId
      const query = { _id: new ObjectId(id) };

      // find the parcel by its ObjectId
      const parcel = await parcelsCollection.findOne(query);
      res.send(parcel);
    });

    // Create a new parcel
    app.post('/parcels', async (req, res) => {
      const parcel = req.body;
      //  add createdAt field with current date
      parcel.createdAt = new Date();
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    // Delete a parcel by ID
    app.delete('/parcels/:id', async (req, res) => {
      // get the id from the request parameters
      const id = req.params.id;
      // create a query to find the parcel by its ObjectId
      const query = { _id: new ObjectId(id) };

      // delete the parcel
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
    // console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Zap Shift Server is running');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
