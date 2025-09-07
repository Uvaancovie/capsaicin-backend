const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('Connected to MongoDB for seeding'))
.catch(err => console.error('MongoDB connection error:', err));

// Product Schema (same as in server.js)
const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  stock_quantity: {
    type: Number,
    required: true,
    default: 0
  },
  category: {
    type: String,
    required: true
  },
  image_url: {
    type: String,
    required: true
  },
  is_featured: {
    type: Boolean,
    default: false
  },
  ingredients: {
    type: String,
    default: ''
  },
  usage_instructions: {
    type: String,
    default: ''
  },
  benefits: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

const Product = mongoose.model('Product', productSchema);

// Sample products data
const sampleProducts = [
  {
    name: "Capsaicin Pain Relief Cream",
    description: "Fast-acting topical cream with natural capsaicin extract for targeted pain relief.",
    price: 299.99,
    stock_quantity: 50,
    category: "Topical Creams",
    image_url: "/placeholder.jpg",
    is_featured: true,
    ingredients: "Capsaicin 0.075%, Menthol, Arnica Extract, Aloe Vera",
    usage_instructions: "Apply thin layer to affected area 3-4 times daily. Wash hands after use.",
    benefits: "Reduces inflammation, provides long-lasting pain relief, improves mobility"
  },
  {
    name: "Capsaicin Roll-On Gel",
    description: "Convenient roll-on application for quick pain relief on-the-go.",
    price: 189.99,
    stock_quantity: 75,
    category: "Roll-On Gels",
    image_url: "/placeholder.jpg",
    is_featured: true,
    ingredients: "Capsaicin 0.05%, Eucalyptus Oil, Camphor",
    usage_instructions: "Roll directly onto skin over painful area. Allow to dry before covering.",
    benefits: "Portable pain relief, non-greasy formula, quick absorption"
  },
  {
    name: "Extra Strength Capsaicin Balm",
    description: "Maximum strength formula for severe chronic pain conditions.",
    price: 449.99,
    stock_quantity: 30,
    category: "Balms",
    image_url: "/placeholder.jpg",
    is_featured: false,
    ingredients: "Capsaicin 0.1%, Wintergreen Oil, Beeswax, Shea Butter",
    usage_instructions: "Apply sparingly to affected area twice daily. For external use only.",
    benefits: "Maximum strength relief, long-lasting effect, moisturizing properties"
  },
  {
    name: "Gentle Capsaicin Lotion",
    description: "Mild formula perfect for sensitive skin and daily use.",
    price: 249.99,
    stock_quantity: 60,
    category: "Lotions",
    image_url: "/placeholder.jpg",
    is_featured: false,
    ingredients: "Capsaicin 0.025%, Calendula Extract, Vitamin E, Coconut Oil",
    usage_instructions: "Massage gently into skin until absorbed. Safe for daily use.",
    benefits: "Gentle on sensitive skin, moisturizing, anti-inflammatory"
  },
  {
    name: "Capsaicin Heat Patch",
    description: "Self-adhesive patches for continuous pain relief up to 8 hours.",
    price: 179.99,
    stock_quantity: 100,
    category: "Patches",
    image_url: "/placeholder.jpg",
    is_featured: true,
    ingredients: "Capsaicin 0.04%, Medical-grade adhesive, Breathable fabric",
    usage_instructions: "Apply to clean, dry skin. Remove after 8 hours maximum.",
    benefits: "Hands-free application, continuous relief, discreet wear"
  },
  {
    name: "Capsaicin Recovery Oil",
    description: "Premium massage oil with capsaicin for post-workout recovery.",
    price: 329.99,
    stock_quantity: 40,
    category: "Massage Oils",
    image_url: "/placeholder.jpg",
    is_featured: false,
    ingredients: "Capsaicin 0.06%, Jojoba Oil, Peppermint Oil, Rosemary Extract",
    usage_instructions: "Massage into muscles before or after exercise. Avoid broken skin.",
    benefits: "Enhances recovery, improves circulation, relaxes muscles"
  }
];

async function seedProducts() {
  try {
    // Clear existing products
    await Product.deleteMany({});
    console.log('Cleared existing products');

    // Insert sample products
    const insertedProducts = await Product.insertMany(sampleProducts);
    console.log(`Successfully seeded ${insertedProducts.length} products`);

    // Display inserted products
    insertedProducts.forEach(product => {
      console.log(`- ${product.name}: R${product.price}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error seeding products:', error);
    process.exit(1);
  }
}

// Run the seeding
seedProducts();
