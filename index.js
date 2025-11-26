const express = require('express');
require('dotenv').config();

const cors = require('cors');
const app = express();
// payment system by stripe
const stripe = require('stripe')(process.env.STRIPE_SECRETE);
const port = process.env.PORT || 5000;

// creating tracking id for parcel
const crypto = require('crypto');
function generateTrackingId() {
  const prefix = 'ZAP'; // your company short code
  const randomBytes = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${date}-${randomBytes}`;
}

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
    const paymentCollection = db.collection('payments');

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

    // stripe payment api implement
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Please Pay for ${paymentInfo.parcelName}`,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        customer_email: paymentInfo.senderEmail,
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      console.log(session);
      res.send({ url: session.url });
    });

    // verify payment
    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log('session retrieve', session);

      // tracking id
      const trackingId = generateTrackingId();
      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: 'paid',
            trackingId: trackingId,
          },
        };
        const result = await parcelsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        if (session.payment_status === 'paid') {
          const paymentResult = await paymentCollection.insertOne(payment);

          res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: paymentResult,
            transactionId: session.payment_intent,
            trackingId: trackingId,
          });
        }
        // res.send(result);
      }

      res.send({ success: false });
    });

    // old api
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      console.log(session);
      res.send({ url: session.url });
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
