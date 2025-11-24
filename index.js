const express = require('express');
require('dotenv').config();

const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;

// mongodb
const { MongoClient, ServerApiVersion } = require('mongodb');

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
    await client.connect();

    // Perform actions using the client here
    const db = client.db('zapShiftDB');
    const parcelsCollection = db.collection('parcels');
    // const usersCollection = db.collection('users');

    // parcels API endpoints would go here
    app.get('/parcels', async (req, res) => {
      // get all parcels
      const query = {};
      // check for query parameters
      const { email } = req.query;
      // if email is provided, filter parcels by senderEmail
      if (email) {
        query.senderEmail = email;
      }
      // if there are query parameters, you can modify the query object accordingly
      const cursor = parcelsCollection.find(query);
      const parcels = await cursor.toArray();
      res.send(parcels);
    });

    app.post('/parcels', async (req, res) => {
      const parcel = req.body;
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
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
