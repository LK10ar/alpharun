// ==========================================
// ALPHARUN CORE ENGINE - FULL STACK BACKEND
// ==========================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // Cryptage de niveau militaire pour les mots de passe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// --- 1. CONFIGURATION RÉSEAU ---
app.use(cors()); // En production, restreindre à ton domaine Front-end

// --- 2. CONNEXION À LA BASE DE DONNÉES (MONGODB ATLAS) ---
// Utilisation de ton URI strict. 
const MONGO_URI = "mongodb+srv://leobarrot_db_user:9B5yXQlaNRe8l8TD@cluster0.36druca.mongodb.net/AlphaRunDB?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Base de données MongoDB AlphaRun connectée et opérationnelle.'))
    .catch(err => console.error('❌ Échec critique de connexion MongoDB :', err));

// --- 3. ARCHITECTURE DES DONNÉES (SCHÉMAS) ---

// A. Les Utilisateurs (Espace Client)
const UserSchema = new mongoose.Schema({
    nom: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    dateCreation: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// B. Les Produits (Shop)
const ProductSchema = new mongoose.Schema({
    name: String,
    price: Number,
    stock: Number,
    aliexpressId: String
});
const Product = mongoose.model('Product', ProductSchema);

// C. Les Commandes (Suivi Logistique)
const OrderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    userEmail: String,
    total: Number,
    status: { type: String, default: 'En cours de traitement' },
    trackingNumber: { type: String, default: 'En attente du transporteur' },
    dateOrder: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);


// --- 4. ROUTE SÉCURISÉE : WEBHOOK STRIPE ---
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // Création automatique d'une commande dans MongoDB lors du paiement
        const nouvelleCommande = new Order({
            orderId: `ORD-${Math.floor(10000 + Math.random() * 90000)}`, // Génère un ID unique
            userEmail: session.customer_details.email,
            total: session.amount_total / 100,
            status: 'Paiement validé - En préparation'
        });
        
        await nouvelleCommande.save();
        console.log(`✅ Commande ${nouvelleCommande.orderId} enregistrée dans la base.`);
        
        // (Appel API AliExpress ici)
    }
    res.json({ received: true });
});

// --- 5. MIDDLEWARE DATA ---
app.use(express.json());

// --- 6. API : SYSTÈME D'AUTHENTIFICATION (ESPACE CLIENT) ---

// Inscription (Hashage du mot de passe)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { nom, email, password } = req.body;
        
        // Vérification si l'utilisateur existe déjà
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ error: "Ce traceur est déjà enregistré." });

        // Cryptage du mot de passe
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Sauvegarde dans MongoDB
        user = new User({ nom, email, password: hashedPassword });
        await user.save();

        res.status(201).json({ message: "Profil AlphaRun créé avec succès." });
    } catch (error) {
        res.status(500).json({ error: "Erreur serveur lors de la création du profil." });
    }
});

// Connexion (Vérification du Hash)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: "Identifiants inconnus." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Mot de passe incorrect." });

        res.status(200).json({ message: "Connexion réussie.", nom: user.nom });
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de la connexion." });
    }
});


// --- 7. API : SUIVI DE COMMANDE ---
app.post('/api/track', async (req, res) => {
    try {
        const { orderId, email } = req.body;
        
        // Cherche la commande exacte dans la base
        const order = await Order.findOne({ orderId: orderId, userEmail: email });
        
        if (!order) {
            return res.status(404).json({ error: "Aucune transmission trouvée avec ces coordonnées." });
        }

        res.status(200).json(order);
    } catch (error) {
        res.status(500).json({ error: "Erreur système lors du tracking." });
    }
});


// --- 8. API : CRÉATION DE PAIEMENT STRIPE ---
app.post('/api/creer-paiement', async (req, res) => {
    try {
        const { items } = req.body; 
        const lineItems = items.map(item => ({
            price_data: {
                currency: 'eur',
                product_data: { name: item.name },
                unit_amount: Math.round(item.price * 100), 
            },
            quantity: item.quantity,
        }));

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            shipping_address_collection: { allowed_countries: ['FR', 'BE', 'CH', 'CA'] },
            line_items: lineItems,
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5500'}/#suivi`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5500'}/#panier`,
        });

        res.status(200).json({ id: session.id, url: session.url });
    } catch (error) {
        res.status(500).json({ error: "Échec de l'initialisation du tunnel de paiement." });
    }
});

// --- 9. DÉMARRAGE DU MOTEUR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ======================================
      ALPHARUN CORE ENGINE ACTIVE
      Connecté à MongoDB Atlas
      Port: ${PORT}
    ======================================
    `);
});