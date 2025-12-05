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
const { send } = require('process');

// middleware
app.use(cors());
app.use(express.json());

const admin = require('firebase-admin');
// const serviceAccount = require('./zap-shift-authentication-firebase-adminsdk.json');
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// own custom middleware
const verifyFBToken = async (req, res, next) => {
  // console.log('headers in the middleware', req.headers.authorization);

  // receive token from client side
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  try {
    const idToken = token.split(' ')[1];

    // real token check kra
    const decoded = await admin.auth().verifyIdToken(idToken);
    // console.log('decoded in the token', decoded);

    req.decoded_email = decoded.email;
    // after verify token move forward to next step
    next();
  } catch (err) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

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
    const paymentCollection = db.collection('payments');
    const usersCollection = db.collection('users');
    const ridersCollection = db.collection('riders');

    // middleware to check user is admin or not
    // must be used after verifyFBToken middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }

      next();
    };

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

    // payment history
    app.get('/payments', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      // console.log('headers', req.headers);

      if (email) {
        query.customerEmail = email;

        // check email for request data
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: 'Forbidden access' });
        }
      }

      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
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

    app.delete('/payments/:id', async (req, res) => {
      // get the id from the request parameters
      const id = req.params.id;
      // create a query to find the parcel by its ObjectId
      const query = { _id: new ObjectId(id) };

      // delete the parcel
      const result = await paymentCollection.deleteOne(query);
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

      // stop hitting on reload page
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: 'already exists',
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

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
          trackingId: trackingId,
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

    // user api

    // all users
    app.get('/users', verifyFBToken, async (req, res) => {
      const search = req.query.search;
      const query = {};
      if (search) {
        // query.displayName = { $regex: search, $options: 'i' };

        // partial matching search input
        query.$or = [
          { displayName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ];
      }
      const cursor = usersCollection.find(query).sort({ createdArt: -1 }).limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });

    // add  user
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdArt = new Date();
      const email = user.email;

      const userExist = await usersCollection.findOne({ email });

      // check user email
      if (userExist) {
        return res.send({ message: 'user exist' });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // update user
    app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: roleInfo.role,
        },
      };

      const result = await usersCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // specific user by the ID
    app.get('/users/:id', async (req, res) => {});

    // check user if he admin or not
    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'user' });
    });

    // rider api

    app.get('/riders', async (req, res) => {
      // const query = { status: 'pending' };

      const query = {};
      // find specific data
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post('/riders', async (req, res) => {
      const rider = req.body;
      rider.status = 'pending';
      rider.createdAt = new Date();

      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.patch('/riders/:id/role', verifyFBToken, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: {
          status: status,
        },
      };

      const result = await ridersCollection.updateOne(query, updatedDoc);
      if (status === 'approved') {
        const email = req.body.email;
        const userQuery = { email };

        const updateUser = {
          $set: {
            role: 'rider',
          },
        };
        const userResult = await usersCollection.updateOne(userQuery, updateUser);
      }
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
