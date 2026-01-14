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
app.use(express.json());
app.use(cors());
// app.use(
//   cors({
//     origin: 'https://zap-shift-osmanzakaria.vercel.app', // Vercel এর domain
//     credentials: true,
//   }),
// );

const admin = require('firebase-admin');

const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);

// const serviceAccount = require('/zap-shift-authentication-firebase-adminsdk.json');
// const { initializeApp } = require('firebase/app'); // Node.js Firebase
// const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

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

    // parcels API endpoints would go here ---------------------------------------------------------------
    // Get all parcels
    app.get('/parcels', async (req, res) => {
      const { email, role, deliveryStatus } = req.query;
      const query = {};

      if (role === 'user') {
        query.senderEmail = email;
      }

      if (role === 'rider') {
        if (!email) return res.status(400).send({ message: 'Rider email required' });
        query.riderEmail = email; // Rider শুধু তার parcels
      }
      // Admin: role=admin হলে সব parcels দেখাবে, query empty থাকলে সব দেখাবে

      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }

      const parcels = await parcelsCollection.find(query).sort({ createdAt: -1 }).toArray();

      res.send(parcels);
    });

    // Get all parcels for admin
    app.get('/parcels/admin', async (req, res) => {
      const { deliveryStatus } = req.query;
      const query = {};

      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }

      const options = { sort: { createdAt: -1 } };
      const parcels = await parcelsCollection.find(query, options).toArray();

      res.send(parcels);
    });

    app.get('/parcels/rider', async (req, res) => {
      const { riderEmail, deliveryStatus } = req.query;
      const query = {};
      if (riderEmail) {
        query.riderEmail = riderEmail;
      }

      if (deliveryStatus) {
        // query.deliveryStatus = { $in: ['driver-assigned', 'rider-arriving'] };
        query.deliveryStatus = { $nin: ['parcel-delivered'] };
      }

      const cursor = parcelsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
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

    app.patch('/parcels/:id', async (req, res) => {
      const { riderName, riderEmail, riderId } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: {
          deliveryStatus: 'driver-assigned',
          riderName: riderName,
          riderEmail: riderEmail,
          riderId: riderId,
        },
      };
      const result = await parcelsCollection.updateOne(query, updatedDoc);

      // also update rider information
      const riderQuery = { _id: new ObjectId(riderId) };
      const riderUpdatedDoc = {
        $set: {
          workStatus: 'In-Process',
        },
      };

      const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc);
      res.send(riderResult);
    });

    app.patch('/parcels/:id/status', async (req, res) => {
      const { deliveryStatus } = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updatedDoc = {
        $set: {
          deliveryStatus: deliveryStatus,
        },
      };
      const result = await parcelsCollection.updateOne(query, updatedDoc);
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

    // stripe payment api implement -----------------------------------------------------------------------------------------
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
    // app.patch('/payment-success', async (req, res) => {
    //   const sessionId = req.query.session_id;
    //   const session = await stripe.checkout.sessions.retrieve(sessionId);
    //   console.log('session retrieve', session);

    //   // stop hitting on reload page
    //   const transactionId = session.payment_intent;
    //   const query = { transactionId: transactionId };
    //   const paymentExist = await paymentCollection.findOne(query);
    //   if (paymentExist) {
    //     return res.send({
    //       message: 'already exists',
    //       transactionId,
    //       trackingId: paymentExist.trackingId,
    //     });
    //   }

    //   // tracking id
    //   const trackingId = generateTrackingId();
    //   if (session.payment_status === 'paid') {
    //     const id = session.metadata.parcelId;
    //     const query = { _id: new ObjectId(id) };
    //     const update = {
    //       $set: {
    //         paymentStatus: 'paid',
    //         deliveryStatus: 'pending-pickup',
    //         trackingId: trackingId,
    //       },
    //     };
    //     const result = await parcelsCollection.updateOne(query, update);
    //     console.log('Parcel update result:', result);

    //     const payment = {
    //       amount: session.amount_total / 100,
    //       currency: session.currency,
    //       customerEmail: session.customer_email,
    //       parcelId: session.metadata.parcelId,
    //       parcelName: session.metadata.parcelName,
    //       transactionId: session.payment_intent,
    //       paymentStatus: session.payment_status,
    //       paidAt: new Date(),
    //       trackingId: trackingId,
    //     };

    //     if (session.payment_status === 'paid') {
    //       const paymentResult = await paymentCollection.insertOne(payment);

    //       res.send({
    //         success: true,
    //         modifyParcel: result,
    //         paymentInfo: paymentResult,
    //         transactionId: session.payment_intent,
    //         trackingId: trackingId,
    //       });
    //     }
    //     // res.send(result);
    //   }

    //   res.send({ success: false });
    // });

    app.patch('/payment-success', async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log('session retrieved', session);

        const transactionId = session.payment_intent;

        // Check if payment already exists
        const paymentExist = await paymentCollection.findOne({ transactionId });
        if (paymentExist) {
          return res.send({
            message: 'already exists',
            transactionId,
            trackingId: paymentExist.trackingId,
          });
        }

        // Generate tracking ID
        const trackingId = generateTrackingId();

        if (session.payment_status === 'paid') {
          const parcelId = session.metadata.parcelId;
          if (!parcelId) return res.status(400).send({ error: 'Parcel ID missing' });

          // Update parcel
          const update = {
            $set: {
              paymentStatus: 'paid',
              deliveryStatus: 'pending-pickup',
              trackingId,
            },
          };
          const result = await parcelsCollection.updateOne({ _id: new ObjectId(parcelId) }, update);
          console.log('Parcel updated:', result);

          // Insert payment record
          const payment = {
            amount: session.amount_total / 100,
            currency: session.currency,
            customerEmail: session.customer_email,
            parcelId: parcelId,
            parcelName: session.metadata.parcelName,
            transactionId,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
            trackingId,
          };
          const paymentResult = await paymentCollection.insertOne(payment);

          return res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: paymentResult,
            transactionId,
            trackingId,
          });
        }

        return res.send({ success: false });
      } catch (error) {
        console.error(error);
        return res.status(500).send({ success: false, error: error.message });
      }
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
        query.$or = [
          { displayName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { role: { $regex: search, $options: 'i' } },
          { region: { $regex: search, $options: 'i' } },
          { district: { $regex: search, $options: 'i' } },
        ];
      }
      const cursor = usersCollection.find(query).sort({ createdArt: -1 });
      const result = await cursor.toArray();

      // Main admin / owner email ( owner email)
      const adminEmail = 'osmanzakaria801@gmail.com';

      const sortedResult = result.sort((a, b) => {
        if (a.email === adminEmail) return -1; // main admin upore
        if (b.email === adminEmail) return 1;

        if (a.role === 'admin' && b.role !== 'admin') return -1; // admin upore normal user
        if (b.role === 'admin' && a.role !== 'admin') return 1;

        // Normal user / admin -> newest first
        return new Date(b.createdArt) - new Date(a.createdArt);
      });

      res.send(sortedResult);
    });

    // add  user
    app.post('/users', async (req, res) => {
      const user = req.body;
      const { email, displayName, region, district, photoURL } = user;
      user.role = 'user';
      user.createdArt = new Date();

      if (!email || !displayName || !region || !district) {
        return res.send({ message: 'Missing required fields' });
      }

      // check user email
      const userExist = await usersCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: 'user exist' });
      }

      // user data to insert in DB
      const userDataToInsertInDB = {
        email,
        displayName,
        region,
        district,
        photoURL,
        role: user.role,
        createdArt: user.createdArt,
      };

      const result = await usersCollection.insertOne(userDataToInsertInDB);
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

    app.delete('/users/:id/delete', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    // rider api ------------------------------------------------------------------------------------

    app.get('/riders', async (req, res) => {
      // const query = { status: 'pending' };
      const { status, riderDistrict, workStatus } = req.query;

      const query = {};
      // find specific data
      if (status) {
        query.status = status;
      }
      if (riderDistrict) {
        query.riderDistrict = { $regex: new RegExp(`^${riderDistrict}$`, 'i') };
        // case-insensitive match
      }
      if (workStatus) {
        query.workStatus = workStatus;
      }

      const cursor = ridersCollection.find(query).sort({ createdAt: -1 });
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

    // 👉 Rider approve/reject করার জন্য PATCH route
    app.patch('/riders/:id/role', verifyFBToken, async (req, res) => {
      const status = req.body.status; // 👉 rider approved বা rejected status
      const id = req.params.id; // 👉 rider এর MongoDB _id
      const query = { _id: new ObjectId(id) };

      // 👉 rider collection-এ তার status + workStatus আপডেট করা
      const updatedDoc = {
        $set: {
          status: status,
          workStatus: 'available', // 👉 approve হলে এখন থেকেই কাজ করতে পারবে
        },
      };
      // 👉 riders collection-এ update
      const result = await ridersCollection.updateOne(query, updatedDoc);

      // 👉 যদি rider approve হয় → তার user role পরিবর্তন করে 'rider' করা
      if (status === 'approved') {
        const email = req.body.email;
        const userQuery = { email };

        const updateUser = {
          $set: {
            role: 'rider', // 👉 user collection এ role সেট করা
          },
        };
        const userResult = await usersCollection.updateOne(userQuery, updateUser);
      }
      // 👉 update result client-এ পাঠানো
      res.send(result);
    });

    app.delete('/riders/:id/delete', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const result = await ridersCollection.deleteOne(query);

        res.send(result); // { deletedCount: 1 } if deleted, { deletedCount: 0 } if not found
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to delete rider', error });
      }
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
