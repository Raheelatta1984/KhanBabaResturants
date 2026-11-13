import type Database from "better-sqlite3";
import { hashPassword } from "../auth/password";
import { DEFAULT_SETTINGS } from "../settings";
import { completeBatch, startBatch } from "../production";

type VariantSeed = { label: string; sizeMl: number | null; price: number; isDefault?: boolean };

type ItemSeed = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  image: string;
  ingredients: string;
  allergens: string;
  spice?: boolean;
  veg?: boolean;
  featured?: boolean;
  isNew?: boolean;
  prep: number;
  variants: VariantSeed[];
  reviews?: { name: string; rating: number; comment: string }[];
};

const cents = (d: number) => Math.round(d * 100);

const CATEGORIES = [
  { slug: "biryani-rice", name: "Biryani & Rice", description: "Layered basmati, slow-cooked in the dum style", sort: 1 },
  { slug: "karahi-curries", name: "Karahi & Curries", description: "Wok-finished karahi and slow-simmered curries", sort: 2 },
  { slug: "tandoor-bbq", name: "Tandoor & BBQ", description: "Charcoal-grilled, straight from the clay oven", sort: 3 },
  { slug: "breads", name: "Naan & Roti", description: "Baked to order in our tandoor", sort: 4 },
  { slug: "burgers", name: "Burgers", description: "Halal patties, house sauces, fresh buns", sort: 5 },
  { slug: "sides", name: "Sides & Snacks", description: "Chaat, samosas and share plates", sort: 6 },
  { slug: "desserts", name: "Desserts", description: "Mithai made in ghee, the Lahori way", sort: 7 },
  { slug: "drinks", name: "Drinks", description: "Lassi, chai and cooling classics", sort: 8 },
];

const ITEMS: ItemSeed[] = [
  {
    slug: "chicken-biryani",
    name: "Chicken Biryani",
    tagline: "The house signature",
    description:
      "Aged basmati layered with marinated chicken, saffron milk and fried onions, sealed and slow-cooked on dum. Served with cooling mint raita.",
    category: "biryani-rice",
    image: "/images/biryani-chicken.jpg",
    ingredients: "Aged basmati rice, chicken, yoghurt, onion, tomato, saffron, ghee, ginger, garlic, garam masala, mint, coriander",
    allergens: "Milk",
    spice: true,
    featured: true,
    prep: 18,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 15.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 29.99 },
    ],
    reviews: [
      { name: "Ayesha K.", rating: 5, comment: "Genuinely the best biryani in the CBD. The 1L tub fed two of us easily." },
      { name: "Daniel M.", rating: 5, comment: "Ordered extra hot — proper heat, not just chilli for the sake of it." },
      { name: "Priya S.", rating: 4, comment: "Beautiful rice, generous chicken. Would love more raita with the large size." },
    ],
  },
  {
    slug: "lamb-dum-biryani",
    name: "Lamb Dum Biryani",
    tagline: "Slow-cooked on the bone",
    description:
      "Lamb shoulder marinated overnight in yoghurt and whole spices, layered with basmati and cooked on dum until it falls apart.",
    category: "biryani-rice",
    image: "/images/biryani-lamb.jpg",
    ingredients: "Aged basmati rice, lamb shoulder, yoghurt, onion, saffron, ghee, garam masala, cardamom, black cumin, mint",
    allergens: "Milk",
    spice: true,
    featured: true,
    prep: 20,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 16.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 31.99 },
    ],
    reviews: [
      { name: "Omar F.", rating: 5, comment: "Lamb was falling off the bone. Reminded me of Gawalmandi." },
      { name: "Kate L.", rating: 4, comment: "Rich and fragrant. Mild is a good starting point." },
    ],
  },
  {
    slug: "goat-biryani",
    name: "Goat Biryani",
    tagline: "Weekend favourite",
    description: "Goat on the bone simmered with whole spices, layered with saffron rice and finished with crisp fried onions.",
    category: "biryani-rice",
    image: "/images/biryani-royal.jpg",
    ingredients: "Basmati rice, goat meat, yoghurt, onion, tomato, whole spices, saffron, ghee, coriander",
    allergens: "Milk",
    spice: true,
    prep: 22,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 16.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 31.99 },
    ],
  },
  {
    slug: "biryani-rice",
    name: "Biryani Rice",
    tagline: "Spiced basmati",
    description: "Our biryani rice on its own — aromatic, buttery and studded with whole spices. Perfect next to a curry.",
    category: "biryani-rice",
    image: "/images/biryani-royal.jpg",
    ingredients: "Basmati rice, ghee, onion, cumin, cardamom, cloves, bay leaf, saffron",
    allergens: "Milk",
    spice: true,
    veg: true,
    prep: 10,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 12.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 22.99 },
    ],
  },
  {
    slug: "plain-rice",
    name: "Plain Rice",
    tagline: "Steamed basmati",
    description: "Fluffy steamed basmati, cooked fresh through service.",
    category: "biryani-rice",
    image: "/images/biryani-royal.jpg",
    ingredients: "Basmati rice, water, salt",
    allergens: "None",
    veg: true,
    prep: 8,
    variants: [{ label: "1 portion", sizeMl: 400, price: 7.99, isDefault: true }],
  },
  {
    slug: "butter-chicken",
    name: "Butter Chicken",
    tagline: "Creamy, gently spiced",
    description:
      "Tandoor-charred chicken folded into a silky tomato, butter and cashew gravy with a touch of fenugreek. A crowd pleaser.",
    category: "karahi-curries",
    image: "/images/karahi-creamy.jpg",
    ingredients: "Chicken thigh, tomato, cream, butter, cashew paste, yoghurt, ginger, garlic, fenugreek, garam masala",
    allergens: "Milk, tree nuts",
    spice: true,
    featured: true,
    prep: 16,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 25.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 44.99 },
    ],
    reviews: [
      { name: "Sarah T.", rating: 5, comment: "So creamy and the spice level was spot on for the kids." },
      { name: "Michael R.", rating: 4, comment: "Great with the garlic naan. Portion is generous." },
    ],
  },
  {
    slug: "chicken-karahi",
    name: "Chicken Karahi",
    tagline: "Wok-fired, Lahori style",
    description:
      "Chicken cooked hard and fast in a karahi with tomato, green chilli and ginger — the way it is made on the roadside in Lahore.",
    category: "karahi-curries",
    image: "/images/karahi-green.jpg",
    ingredients: "Chicken, tomato, green chilli, ginger, garlic, cooking oil, coriander, cumin, black pepper, salt",
    allergens: "None",
    spice: true,
    featured: true,
    prep: 18,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 21.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 39.99 },
    ],
    reviews: [{ name: "Hassan A.", rating: 5, comment: "Tastes like Lahore. Extra hot is the way to go." }],
  },
  {
    slug: "chicken-tikka-masala",
    name: "Chicken Tikka Masala",
    tagline: "Charred then simmered",
    description: "Tandoori chicken tikka in a rich tomato masala with a hint of smoke from the clay oven.",
    category: "karahi-curries",
    image: "/images/karahi-masala.jpg",
    ingredients: "Chicken tikka, tomato, onion, cream, butter, ginger, garlic, garam masala, paprika",
    allergens: "Milk",
    spice: true,
    prep: 16,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 22.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 39.99 },
    ],
  },
  {
    slug: "beef-nihari",
    name: "Beef Nihari",
    tagline: "Overnight braise",
    description:
      "Beef shank braised overnight with nihari masala until the gravy turns glossy and thick. Finished with ginger, chilli and lime.",
    category: "karahi-curries",
    image: "/images/nihari.jpg",
    ingredients: "Beef shank, nihari masala, onion, ginger, garlic, wheat flour, ghee, green chilli, lime",
    allergens: "Gluten",
    spice: true,
    prep: 12,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 22.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 39.99 },
    ],
    reviews: [{ name: "Zainab H.", rating: 5, comment: "Deep, spicy and rich. Order the naan to go with it." }],
  },
  {
    slug: "daal-makhni",
    name: "Daal Makhni",
    tagline: "Slow lentils, lots of butter",
    description: "Black lentils simmered for hours with tomato, butter and cream until velvety. Vegetarian and deeply comforting.",
    category: "karahi-curries",
    image: "/images/daal-makhani.jpg",
    ingredients: "Black lentils, tomato, butter, cream, onion, garlic, cumin, chilli, coriander",
    allergens: "Milk",
    spice: true,
    veg: true,
    prep: 12,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 17.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 30.99 },
    ],
  },
  {
    slug: "chicken-tikka",
    name: "Chicken Tikka",
    tagline: "6 pieces",
    description: "Boneless chicken thigh marinated in spiced yoghurt and chargrilled in the tandoor. Served with mint chutney.",
    category: "tandoor-bbq",
    image: "/images/tikka-platter.jpg",
    ingredients: "Chicken thigh, yoghurt, lemon, ginger, garlic, red chilli, garam masala, mint chutney",
    allergens: "Milk",
    spice: true,
    featured: true,
    prep: 18,
    variants: [{ label: "6 pieces", sizeMl: null, price: 17.99, isDefault: true }],
    reviews: [{ name: "Ali R.", rating: 5, comment: "Smoky and juicy. Chutney is excellent." }],
  },
  {
    slug: "chicken-malai-boti",
    name: "Chicken Malai Boti",
    tagline: "6 pieces",
    description: "Creamy, mild and tender — chicken marinated in cream, cheese and white pepper, then chargrilled.",
    category: "tandoor-bbq",
    image: "/images/tikka-grill.jpg",
    ingredients: "Chicken breast, cream, cheddar, yoghurt, white pepper, garlic, coriander",
    allergens: "Milk",
    spice: true,
    prep: 18,
    variants: [{ label: "6 pieces", sizeMl: null, price: 17.99, isDefault: true }],
  },
  {
    slug: "seekh-kebab",
    name: "Seekh Kebab",
    tagline: "Beef, chicken or lamb",
    description: "Hand-minced meat with herbs and green chilli, moulded onto skewers and grilled over charcoal.",
    category: "tandoor-bbq",
    image: "/images/kebab-platter.jpg",
    ingredients: "Minced beef, onion, green chilli, coriander, mint, ginger garlic, kebab masala",
    allergens: "None",
    spice: true,
    prep: 20,
    variants: [
      { label: "2 pieces", sizeMl: null, price: 16.99, isDefault: true },
      { label: "5 pieces", sizeMl: null, price: 35.99 },
    ],
  },
  {
    slug: "bbq-mix-platter",
    name: "BBQ Mix Platter",
    tagline: "Best of the grill",
    description: "Three chicken tikka, one chicken reshmi kebab and one lamb seekh kebab, served with raita.",
    category: "tandoor-bbq",
    image: "/images/kebab-2.jpg",
    ingredients: "Chicken tikka, chicken reshmi kebab, lamb seekh kebab, raita, mint chutney",
    allergens: "Milk",
    spice: true,
    prep: 22,
    variants: [{ label: "1 platter", sizeMl: null, price: 22.99, isDefault: true }],
  },
  {
    slug: "bbq-platter",
    name: "BBQ Platter",
    tagline: "Feeds 2–3",
    description: "Three chicken tikka, three malai boti, two reshmi kebabs and two lamb seekh kebabs with raita.",
    category: "tandoor-bbq",
    image: "/images/kebab-3.jpg",
    ingredients: "Chicken tikka, malai boti, reshmi kebab, lamb seekh kebab, raita",
    allergens: "Milk",
    spice: true,
    prep: 24,
    variants: [{ label: "1 platter", sizeMl: null, price: 34.99, isDefault: true }],
  },
  {
    slug: "family-feast-platter",
    name: "Family Feast Platter",
    tagline: "Feeds 4–5",
    description:
      "Six chicken tikka, two reshmi kebabs, two lamb seekh kebabs and half a tandoori chicken. Built for sharing.",
    category: "tandoor-bbq",
    image: "/images/feast-2.jpg",
    ingredients: "Chicken tikka, reshmi kebab, lamb seekh kebab, tandoori chicken, raita, salad",
    allergens: "Milk",
    spice: true,
    prep: 28,
    variants: [{ label: "1 platter", sizeMl: null, price: 47.99, isDefault: true }],
  },
  {
    slug: "plain-naan",
    name: "Plain Naan",
    tagline: "From the tandoor",
    description: "Fluffy, blistered naan baked to order against the clay wall of our tandoor.",
    category: "breads",
    image: "/images/naan-basket.jpg",
    ingredients: "Atta flour, water, yoghurt, yeast, salt",
    allergens: "Gluten, Milk",
    veg: true,
    prep: 6,
    variants: [{ label: "1 piece", sizeMl: null, price: 2.49, isDefault: true }],
  },
  {
    slug: "butter-naan",
    name: "Butter Naan",
    tagline: "Brushed with ghee",
    description: "Our plain naan finished with a generous brush of melted butter.",
    category: "breads",
    image: "/images/naan-dips.jpg",
    ingredients: "Atta flour, water, yoghurt, yeast, butter, salt",
    allergens: "Gluten, Milk",
    veg: true,
    prep: 6,
    variants: [{ label: "1 piece", sizeMl: null, price: 2.99, isDefault: true }],
  },
  {
    slug: "garlic-naan",
    name: "Garlic Naan",
    tagline: "Garlic butter, coriander",
    description: "Naan infused with garlic butter and finished with fresh coriander.",
    category: "breads",
    image: "/images/garlic-naan.jpg",
    ingredients: "Atta flour, water, yoghurt, yeast, garlic, butter, coriander",
    allergens: "Gluten, Milk",
    veg: true,
    featured: true,
    prep: 6,
    variants: [{ label: "1 piece", sizeMl: null, price: 3.49, isDefault: true }],
    reviews: [{ name: "Emma W.", rating: 5, comment: "Ordered three. No regrets." }],
  },
  {
    slug: "tandoori-roti",
    name: "Tandoori Roti",
    tagline: "Wholemeal, no oil",
    description: "Wholemeal flatbread baked in the tandoor — light, chewy and perfect with nihari.",
    category: "breads",
    image: "/images/tandoor-oven.jpg",
    ingredients: "Wholemeal atta, water, salt",
    allergens: "Gluten",
    veg: true,
    prep: 6,
    variants: [{ label: "1 piece", sizeMl: null, price: 2.99, isDefault: true }],
  },
  {
    slug: "kb-chicken-burger",
    name: "KB Chicken Burger",
    tagline: "House special sauce",
    description: "Crispy chicken patty, KB special sauce, coleslaw, onion and cheese in a toasted bun.",
    category: "burgers",
    image: "/images/burger-classic.jpg",
    ingredients: "Chicken patty, burger bun, cheese, coleslaw, onion, KB special sauce",
    allergens: "Gluten, Milk, Egg",
    prep: 12,
    variants: [{ label: "1 burger", sizeMl: null, price: 16.99, isDefault: true }],
  },
  {
    slug: "kb-beef-burger",
    name: "KB Beef Burger",
    tagline: "Flame-grilled",
    description: "Halal beef patty with KB special sauce, pickles, onion and cheese.",
    category: "burgers",
    image: "/images/burger-black.jpg",
    ingredients: "Beef patty, burger bun, cheese, pickles, onion, KB special sauce",
    allergens: "Gluten, Milk, Egg",
    prep: 12,
    variants: [{ label: "1 burger", sizeMl: null, price: 16.99, isDefault: true }],
  },
  {
    slug: "samosa",
    name: "Samosa",
    tagline: "Potato & pea",
    description: "Crisp triangular pastries stuffed with spiced potato and peas, served with raita and tamarind chutney.",
    category: "sides",
    image: "/images/samosa.jpg",
    ingredients: "Pastry, potato, peas, cumin, coriander, chilli, tamarind chutney, raita",
    allergens: "Gluten, Milk",
    veg: true,
    prep: 8,
    variants: [
      { label: "1 piece", sizeMl: null, price: 5.99, isDefault: true },
      { label: "2 pieces", sizeMl: null, price: 10.99 },
    ],
  },
  {
    slug: "samosa-chaat",
    name: "Samosa Chaat",
    tagline: "Street food classic",
    description: "Crushed samosas topped with chickpeas, raita, tamarind and mint chutney, and sev.",
    category: "sides",
    image: "/images/samosa-2.jpg",
    ingredients: "Samosa, chickpeas, yoghurt, tamarind chutney, mint chutney, sev, onion",
    allergens: "Gluten, Milk",
    veg: true,
    prep: 10,
    variants: [{ label: "1 bowl", sizeMl: null, price: 13.99, isDefault: true }],
  },
  {
    slug: "gulab-jamun",
    name: "Gulab Jamun",
    tagline: "4 pieces",
    description: "Soft milk dumplings fried until golden and soaked in cardamom sugar syrup.",
    category: "desserts",
    image: "/images/gulab-jamun.jpg",
    ingredients: "Milk powder, flour, ghee, sugar, cardamom, rose water",
    allergens: "Milk, Gluten",
    veg: true,
    prep: 3,
    variants: [{ label: "4 pieces", sizeMl: null, price: 6.99, isDefault: true }],
  },
  {
    slug: "suji-halwa",
    name: "Suji Halwa",
    tagline: "Made in ghee",
    description: "Golden semolina pudding cooked in ghee with almonds, pistachios and raisins.",
    category: "desserts",
    image: "/images/suji-halwa.jpg",
    ingredients: "Semolina, ghee, sugar, almonds, pistachios, raisins, cardamom",
    allergens: "Gluten, Milk, tree nuts",
    veg: true,
    prep: 5,
    variants: [{ label: "1 bowl", sizeMl: null, price: 6.99, isDefault: true }],
  },
  {
    slug: "mango-lassi",
    name: "Mango Lassi",
    tagline: "Chilled & thick",
    description: "Yoghurt blended with Alphonso mango pulp and a pinch of cardamom.",
    category: "drinks",
    image: "/images/mango-lassi.jpg",
    ingredients: "Yoghurt, mango pulp, milk, sugar, cardamom",
    allergens: "Milk",
    veg: true,
    prep: 3,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 6.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 12.99 },
    ],
  },
  {
    slug: "chai",
    name: "Doodh Patti Chai",
    tagline: "Karak, the way it should be",
    description: "Strong black tea boiled down with milk, cardamom and cinnamon.",
    category: "drinks",
    image: "/images/chai.jpg",
    ingredients: "Tea leaves, milk, sugar, cardamom, cinnamon",
    allergens: "Milk",
    veg: true,
    prep: 4,
    variants: [{ label: "1 cup", sizeMl: null, price: 5.99, isDefault: true }],
  },
];

const MATERIALS = [
  { name: "Chicken (bone-in)", sku: "MAT-CHK-BI", unit: "kg", packQty: 10, packCost: 129.9, stock: 22, reorder: 10, supplier: "Sydney Halal Meats" },
  { name: "Chicken breast", sku: "MAT-CHK-BR", unit: "kg", packQty: 10, packCost: 99.0, stock: 9, reorder: 5, supplier: "Sydney Halal Meats" },
  { name: "Lamb shoulder", sku: "MAT-LMB", unit: "kg", packQty: 8, packCost: 159.2, stock: 11, reorder: 5, supplier: "Sydney Halal Meats" },
  { name: "Goat (bone-in)", sku: "MAT-GOAT", unit: "kg", packQty: 8, packCost: 175.2, stock: 6, reorder: 4, supplier: "Sydney Halal Meats" },
  { name: "Beef shank", sku: "MAT-BEEF", unit: "kg", packQty: 8, packCost: 135.2, stock: 8, reorder: 5, supplier: "Sydney Halal Meats" },
  { name: "Beef mince", sku: "MAT-MINCE", unit: "kg", packQty: 5, packCost: 52.5, stock: 6, reorder: 3, supplier: "Sydney Halal Meats" },
  { name: "Basmati rice (aged)", sku: "MAT-RICE", unit: "kg", packQty: 20, packCost: 44.0, stock: 38, reorder: 15, supplier: "Punjab Grocers" },
  { name: "Atta flour", sku: "MAT-ATTA", unit: "kg", packQty: 25, packCost: 30.0, stock: 42, reorder: 20, supplier: "Punjab Grocers" },
  { name: "Ghee", sku: "MAT-GHEE", unit: "kg", packQty: 5, packCost: 47.5, stock: 4.2, reorder: 2, supplier: "Punjab Grocers" },
  { name: "Cooking oil", sku: "MAT-OIL", unit: "L", packQty: 20, packCost: 52.0, stock: 15, reorder: 8, supplier: "Punjab Grocers" },
  { name: "Yoghurt", sku: "MAT-YOG", unit: "kg", packQty: 5, packCost: 18.5, stock: 7.5, reorder: 3, supplier: "Dairy Direct" },
  { name: "Tomatoes", sku: "MAT-TOM", unit: "kg", packQty: 10, packCost: 29.9, stock: 16, reorder: 8, supplier: "Flemington Produce" },
  { name: "Onions", sku: "MAT-ONI", unit: "kg", packQty: 10, packCost: 19.9, stock: 18, reorder: 8, supplier: "Flemington Produce" },
  { name: "Ginger garlic paste", sku: "MAT-GGP", unit: "kg", packQty: 2, packCost: 16.4, stock: 2.8, reorder: 1, supplier: "Punjab Grocers" },
  { name: "KB masala blend", sku: "MAT-MASALA", unit: "kg", packQty: 2, packCost: 38.0, stock: 3.4, reorder: 1.5, supplier: "In-house blend" },
  { name: "Cream", sku: "MAT-CREAM", unit: "L", packQty: 2, packCost: 9.8, stock: 3, reorder: 1, supplier: "Dairy Direct" },
  { name: "Butter", sku: "MAT-BUTTER", unit: "kg", packQty: 5, packCost: 42.5, stock: 2.5, reorder: 1, supplier: "Dairy Direct" },
  { name: "Green chilli", sku: "MAT-CHILLI", unit: "kg", packQty: 2, packCost: 11.0, stock: 1.4, reorder: 0.5, supplier: "Flemington Produce" },
  { name: "Coriander", sku: "MAT-CORI", unit: "bunch", packQty: 10, packCost: 12.0, stock: 6, reorder: 3, supplier: "Flemington Produce" },
  { name: "Saffron", sku: "MAT-SAFF", unit: "g", packQty: 10, packCost: 95.0, stock: 8, reorder: 3, supplier: "Punjab Grocers" },
  { name: "Black lentils", sku: "MAT-DAAL", unit: "kg", packQty: 10, packCost: 28.0, stock: 12, reorder: 5, supplier: "Punjab Grocers" },
  { name: "Mango pulp", sku: "MAT-MANGO", unit: "L", packQty: 4, packCost: 24.0, stock: 5, reorder: 2, supplier: "Dairy Direct" },
  { name: "Milk powder", sku: "MAT-MILK", unit: "kg", packQty: 1, packCost: 18.0, stock: 2, reorder: 1, supplier: "Dairy Direct" },
  { name: "Sugar", sku: "MAT-SUGAR", unit: "kg", packQty: 10, packCost: 13.0, stock: 6, reorder: 3, supplier: "Punjab Grocers" },
  { name: "Tea leaves", sku: "MAT-TEA", unit: "kg", packQty: 1, packCost: 22.0, stock: 1.2, reorder: 0.5, supplier: "Punjab Grocers" },
  { name: "Burger buns", sku: "MAT-BUN", unit: "each", packQty: 24, packCost: 12.0, stock: 36, reorder: 24, supplier: "Bakehouse" },
  { name: "Lettuce", sku: "MAT-LETTUCE", unit: "kg", packQty: 3, packCost: 21.0, stock: 2.4, reorder: 1, supplier: "Flemington Produce" },
  { name: "Samosa pastry", sku: "MAT-PASTRY", unit: "each", packQty: 50, packCost: 18.0, stock: 44, reorder: 20, supplier: "Punjab Grocers" },
  { name: "Potatoes", sku: "MAT-POTATO", unit: "kg", packQty: 10, packCost: 16.0, stock: 21, reorder: 10, supplier: "Flemington Produce" },
  { name: "Gulab jamun mix", sku: "MAT-GULAB", unit: "kg", packQty: 2, packCost: 22.0, stock: 1.6, reorder: 1, supplier: "Punjab Grocers" },
  { name: "Semolina", sku: "MAT-SUJI", unit: "kg", packQty: 5, packCost: 9.5, stock: 3.2, reorder: 1.5, supplier: "Punjab Grocers" },
  { name: "Almonds & pistachios", sku: "MAT-NUTS", unit: "kg", packQty: 2, packCost: 46.0, stock: 1.1, reorder: 0.8, supplier: "Punjab Grocers" },
  { name: "Chicken patty", sku: "MAT-PATTY-C", unit: "each", packQty: 20, packCost: 26.0, stock: 28, reorder: 20, supplier: "Sydney Halal Meats" },
  { name: "Beef patty", sku: "MAT-PATTY-B", unit: "each", packQty: 20, packCost: 30.0, stock: 22, reorder: 20, supplier: "Sydney Halal Meats" },
];

type RecipeSeed = {
  name: string;
  menuItemSlug?: string;
  outputKind: "menu_item" | "batch";
  outputQty: number;
  outputUnit: string;
  prepMinutes: number;
  notes: string;
  lines: [string, number][];
};

const RECIPES: RecipeSeed[] = [
  {
    name: "Chicken Biryani — 500 ml portion",
    menuItemSlug: "chicken-biryani",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 18,
    notes: "Standard 500 ml tub. Double for the 1 L tub.",
    lines: [
      ["Chicken (bone-in)", 0.18],
      ["Basmati rice (aged)", 0.16],
      ["Ghee", 0.02],
      ["Yoghurt", 0.04],
      ["Onions", 0.09],
      ["Tomatoes", 0.05],
      ["KB masala blend", 0.012],
      ["Saffron", 0.03],
      ["Cooking oil", 0.01],
      ["Coriander", 0.05],
    ],
  },
  {
    name: "Lamb Dum Biryani — 500 ml portion",
    menuItemSlug: "lamb-dum-biryani",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 20,
    notes: "Lamb shoulder on the bone, marinated overnight.",
    lines: [
      ["Lamb shoulder", 0.18],
      ["Basmati rice (aged)", 0.16],
      ["Ghee", 0.02],
      ["Yoghurt", 0.05],
      ["Onions", 0.09],
      ["KB masala blend", 0.014],
      ["Saffron", 0.03],
    ],
  },
  {
    name: "Butter Chicken — 500 ml portion",
    menuItemSlug: "butter-chicken",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 16,
    notes: "Cashew paste is made in-house each morning.",
    lines: [
      ["Chicken breast", 0.17],
      ["Tomatoes", 0.12],
      ["Cream", 0.06],
      ["Butter", 0.02],
      ["Yoghurt", 0.03],
      ["KB masala blend", 0.012],
      ["Ginger garlic paste", 0.015],
    ],
  },
  {
    name: "Chicken Karahi — 500 ml portion",
    menuItemSlug: "chicken-karahi",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 18,
    notes: "Cooked to order in the karahi.",
    lines: [
      ["Chicken (bone-in)", 0.2],
      ["Tomatoes", 0.15],
      ["Onions", 0.06],
      ["Cooking oil", 0.03],
      ["KB masala blend", 0.015],
      ["Green chilli", 0.01],
      ["Ginger garlic paste", 0.015],
      ["Coriander", 0.05],
    ],
  },
  {
    name: "Beef Nihari — 500 ml portion",
    menuItemSlug: "beef-nihari",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 12,
    notes: "Braise is started the night before.",
    lines: [
      ["Beef shank", 0.2],
      ["KB masala blend", 0.02],
      ["Onions", 0.05],
      ["Cooking oil", 0.03],
      ["Ginger garlic paste", 0.02],
    ],
  },
  {
    name: "Daal Makhni — 500 ml portion",
    menuItemSlug: "daal-makhni",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 12,
    notes: "Lentils soaked overnight, finished with butter and cream.",
    lines: [
      ["Black lentils", 0.12],
      ["Butter", 0.02],
      ["Cream", 0.04],
      ["Tomatoes", 0.08],
      ["Onions", 0.04],
    ],
  },
  {
    name: "Naan — 50 piece batch",
    menuItemSlug: "plain-naan",
    outputKind: "batch",
    outputQty: 50,
    outputUnit: "pieces",
    prepMinutes: 90,
    notes: "Dough rests 45 minutes. One batch covers a lunch service.",
    lines: [
      ["Atta flour", 6],
      ["Yoghurt", 0.5],
      ["Ghee", 0.3],
      ["Sugar", 0.1],
      ["Milk powder", 0.15],
    ],
  },
  {
    name: "Tandoori Roti — 60 piece batch",
    menuItemSlug: "tandoori-roti",
    outputKind: "batch",
    outputQty: 60,
    outputUnit: "pieces",
    prepMinutes: 75,
    notes: "Wholemeal, no oil in the dough.",
    lines: [
      ["Atta flour", 5],
      ["Cooking oil", 0.2],
    ],
  },
  {
    name: "Seekh Kebab — 40 piece batch",
    menuItemSlug: "seekh-kebab",
    outputKind: "batch",
    outputQty: 40,
    outputUnit: "pieces",
    prepMinutes: 60,
    notes: "Mince by hand for the right texture.",
    lines: [
      ["Beef mince", 4],
      ["Onions", 0.8],
      ["KB masala blend", 0.2],
      ["Ginger garlic paste", 0.1],
      ["Coriander", 0.5],
    ],
  },
  {
    name: "Samosa — 50 piece batch",
    menuItemSlug: "samosa",
    outputKind: "batch",
    outputQty: 50,
    outputUnit: "pieces",
    prepMinutes: 70,
    notes: "Filled and folded by hand each morning.",
    lines: [
      ["Samosa pastry", 50],
      ["Potatoes", 2.5],
      ["KB masala blend", 0.15],
      ["Cooking oil", 0.5],
    ],
  },
];

const HOLIDAYS = [
  ["2026-01-01", "New Year's Day", 15],
  ["2026-01-26", "Australia Day", 10],
  ["2026-04-03", "Good Friday", 15],
  ["2026-04-04", "Easter Saturday", 10],
  ["2026-04-06", "Easter Monday", 10],
  ["2026-04-25", "Anzac Day", 10],
  ["2026-06-08", "King's Birthday", 10],
  ["2026-10-05", "NSW Labour Day", 10],
  ["2026-12-25", "Christmas Day", 15],
  ["2026-12-26", "Boxing Day", 10],
  ["2027-01-01", "New Year's Day", 15],
  ["2027-01-26", "Australia Day", 10],
];

export function seedDatabase(db: Database.Database): void {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM menu_items").get() as { c: number };
  if (existing.c > 0) return;

  const seedCore = db.transaction(() => {
    seedSettings(db);
    seedStaff(db);
    seedTables(db);
    seedPricing(db);
    seedCategoriesAndMenu(db);
    seedMaterialsAndRecipes(db);
    seedWhatsNew(db);
  });
  seedCore();

  seedProductionAndOrders(db);
}

function seedSettings(db: Database.Database) {
  const insert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  insert.run("restaurant_name", "Khan Baba Restaurant");
}

function seedStaff(db: Database.Database) {
  const password = hashPassword("KhanBaba2026!");
  const staff = [
    ["Raheel Atta", "admin@khanbaba.com.au", "admin"],
    ["Sana Malik", "manager@khanbaba.com.au", "manager"],
    ["Imran Shah", "counter@khanbaba.com.au", "counter"],
    ["Chef Bilal", "kitchen@khanbaba.com.au", "kitchen"],
    ["Hamza Ali", "delivery@khanbaba.com.au", "delivery"],
  ];
  const insert = db.prepare("INSERT INTO staff (name, email, role, password_hash) VALUES (?, ?, ?, ?)");
  for (const [name, email, role] of staff) insert.run(name, email, role, password);
}

function seedTables(db: Database.Database) {
  const insert = db.prepare("INSERT INTO dining_tables (code, name, zone, seats) VALUES (?, ?, ?, ?)");
  const zones = ["Ground floor", "Window", "Mezzanine"];
  for (let i = 1; i <= 12; i++) {
    const code = `T${String(i).padStart(2, "0")}`;
    insert.run(code, `Table ${i}`, zones[i % zones.length], i <= 2 ? 2 : i <= 8 ? 4 : 6);
  }
}

function seedPricing(db: Database.Database) {
  const insertRule = db.prepare(
    `INSERT INTO pricing_rules (code, label, kind, calc, value, applies_to, days, start_time, end_time, min_subtotal_cents, description, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertRule.run(
    "weekend_surcharge",
    "Weekend surcharge",
    "weekend",
    "percent",
    5,
    "all",
    "0,6",
    null,
    null,
    0,
    "5% applies to Saturday and Sunday orders.",
    10,
  );
  insertRule.run(
    "public_holiday_surcharge",
    "Public holiday surcharge",
    "public_holiday",
    "percent",
    10,
    "all",
    null,
    null,
    null,
    0,
    "10% applies on dates in the public holiday calendar (a holiday replaces the weekend rate).",
    5,
  );
  insertRule.run(
    "priority_standard",
    "Priority preparation",
    "priority",
    "flat",
    2.5,
    "delivery,pickup",
    null,
    null,
    null,
    0,
    "Optional: jump the kitchen queue. Never charged to dine-in or table guests.",
    50,
  );
  insertRule.run(
    "priority_peak_lunch",
    "Peak hour priority — lunch",
    "priority",
    "flat",
    4.5,
    "delivery,pickup",
    "1,2,3,4,5",
    "12:00",
    "14:00",
    0,
    "Lunch peak window, Monday to Friday.",
    40,
  );
  insertRule.run(
    "priority_peak_dinner",
    "Peak hour priority — dinner",
    "priority",
    "flat",
    4.5,
    "delivery,pickup",
    "4,5,6",
    "18:00",
    "21:30",
    0,
    "Thursday to Saturday dinner peak.",
    40,
  );

  const insertHoliday = db.prepare(
    "INSERT OR IGNORE INTO holidays (date, name, surcharge_percent) VALUES (?, ?, ?)",
  );
  for (const [date, name, percent] of HOLIDAYS) insertHoliday.run(date, name, percent);
}

function seedCategoriesAndMenu(db: Database.Database) {
  const insertCategory = db.prepare(
    "INSERT INTO categories (slug, name, description, sort_order) VALUES (?, ?, ?, ?)",
  );
  const categoryIds = new Map<string, number>();
  for (const category of CATEGORIES) {
    const info = insertCategory.run(category.slug, category.name, category.description, category.sort);
    categoryIds.set(category.slug, Number(info.lastInsertRowid));
  }

  const insertItem = db.prepare(
    `INSERT INTO menu_items (slug, name, tagline, description, category_id, image, ingredients, allergens,
      spice_levels, prep_minutes, is_veg, is_available, is_featured, is_new, published, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?)`,
  );
  const insertVariant = db.prepare(
    `INSERT INTO item_variants (item_id, label, size_ml, price_cents, is_default, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertReview = db.prepare(
    "INSERT INTO reviews (item_id, customer_name, rating, comment, status, created_at) VALUES (?, ?, ?, ?, 'published', datetime('now', ?))",
  );

  ITEMS.forEach((item, index) => {
    const categoryId = categoryIds.get(item.category) ?? null;
    const info = insertItem.run(
      item.slug,
      item.name,
      item.tagline,
      item.description,
      categoryId,
      item.image,
      item.ingredients,
      item.allergens,
      item.spice ? "blend,mild,hot,extra_hot" : "",
      item.prep,
      item.veg ? 1 : 0,
      item.featured ? 1 : 0,
      item.isNew ? 1 : 0,
      index,
    );
    const itemId = Number(info.lastInsertRowid);
    item.variants.forEach((variant, variantIndex) => {
      insertVariant.run(
        itemId,
        variant.label,
        variant.sizeMl,
        cents(variant.price),
        variant.isDefault ? 1 : variantIndex === 0 ? 1 : 0,
        variantIndex,
      );
    });
    (item.reviews ?? []).forEach((review, reviewIndex) => {
      insertReview.run(
        itemId,
        review.name,
        review.rating,
        review.comment,
        `-${reviewIndex + 2} days`,
      );
    });
  });
}

function seedMaterialsAndRecipes(db: Database.Database) {
  const insertMaterial = db.prepare(
    `INSERT INTO materials (name, sku, unit, pack_qty, pack_cost_cents, stock_qty, reorder_level, supplier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const materialIds = new Map<string, number>();
  for (const material of MATERIALS) {
    const info = insertMaterial.run(
      material.name,
      material.sku,
      material.unit,
      material.packQty,
      cents(material.packCost),
      material.stock,
      material.reorder,
      material.supplier,
    );
    materialIds.set(material.name, Number(info.lastInsertRowid));
  }

  const insertRecipe = db.prepare(
    `INSERT INTO recipes (name, output_kind, menu_item_id, output_qty, output_unit, prep_minutes, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLine = db.prepare("INSERT INTO recipe_lines (recipe_id, material_id, qty, unit) VALUES (?, ?, ?, ?)");

  for (const recipe of RECIPES) {
    const menuItem = recipe.menuItemSlug
      ? (db.prepare("SELECT id FROM menu_items WHERE slug = ?").get(recipe.menuItemSlug) as { id: number } | undefined)
      : undefined;
    const info = insertRecipe.run(
      recipe.name,
      recipe.outputKind,
      menuItem?.id ?? null,
      recipe.outputQty,
      recipe.outputUnit,
      recipe.prepMinutes,
      recipe.notes,
    );
    const recipeId = Number(info.lastInsertRowid);
    for (const [materialName, qty] of recipe.lines) {
      const materialId = materialIds.get(materialName);
      if (!materialId) continue;
      const unit = MATERIALS.find((m) => m.name === materialName)?.unit ?? "kg";
      insertLine.run(recipeId, materialId, qty, unit);
    }
  }
}

function seedWhatsNew(db: Database.Database) {
  const insert = db.prepare(
    `INSERT INTO whats_new (title, summary, body, category, version, pr_number, pr_url, pinned, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
  );
  const prUrl = "https://github.com/Raheelatta1984/KhanBabaResturants/pull/1";
  const entries: [string, string, string, string, number, string][] = [
    [
      "Order online, your way",
      "Delivery, click & collect and dine-in from one dynamic menu — with 500 ml and 1000 ml containers for biryani and curries.",
      "The static Wix menu is now a live catalogue. Every dish is configurable: choose a container size, pick your heat level and add kitchen notes. Prices, ingredients, allergens and preparation times all come from the database, so the menu can change without a deploy.",
      "feature",
      1,
      "-3 hours",
    ],
    [
      "Uber Direct delivery quotes",
      "Live courier quotes at checkout, with the fee shown before you pay.",
      "We request a delivery quote from Uber Direct for your address while you check out, apply the restaurant's service margin and show the final fee in the order summary. The delivery team signs off the courier request from their own portal once the food is packed.",
      "feature",
      1,
      "-3 hours",
    ],
    [
      "Kitchen and delivery portals",
      "Counter → kitchen → courier, with every hand-off tracked.",
      "Orders accepted at the counter appear instantly on the kitchen display. Items tick off as they are prepared, the ticket is bumped when packed, and the delivery coordinator triggers the courier request. Customers see the same progress bar.",
      "portal",
      1,
      "-3 hours",
    ],
    [
      "Table QR ordering with live progress",
      "Scan the QR at your table, order in seconds and track preparation.",
      "Each table has its own QR code and ordering page. Table orders are confirmed by the counter, prepared in the kitchen and can be paid online or at the counter on the way out. Guests follow a live completion percentage from confirmation to serve.",
      "feature",
      1,
      "-2 hours",
    ],
    [
      "Manufacturing & material costing",
      "Every naan, roti and curry batch carries its material cost.",
      "Production runs draw down stock and lodge a cost against every material consumed — flour, ghee, chicken, masala and more. The admin dashboard shows cost per portion against menu price, so margins are visible in real time.",
      "feature",
      1,
      "-2 hours",
    ],
    [
      "Weekend, public holiday and peak pricing",
      "Rules-based surcharges, fully configurable.",
      "Maintain a calendar of NSW public holidays and let pricing rules apply weekend or holiday surcharges automatically. Priority preparation can be offered in peak windows for delivery and pick-up only — never to table guests.",
      "improvement",
      1,
      "-1 hours",
    ],
    [
      "New dish onboarding with video",
      "Upload photos, paste a YouTube link, publish when ready.",
      "Add a dish with images, ingredients, allergens, spice levels and container sizes. A YouTube link plays inline in the dish page using the privacy-enhanced player — no third-party widget or tracking script on the site.",
      "improvement",
      1,
      "-1 hours",
    ],
    [
      "This release feed",
      "What's New is built into the site.",
      "Every pull request can add a note here. The feed is published from the admin console, and the scripts/whats-new.mjs helper drafts entries straight from your git history.",
      "ops",
      1,
      "-30 minutes",
    ],
  ];

  for (const [title, summary, body, category, _, offset] of entries) {
    insert.run(title, summary, body, category, "1.0.0", 1, prUrl, 0, offset);
  }
  db.prepare("UPDATE whats_new SET pinned = 1 WHERE title = 'Order online, your way'").run();
}

function seedProductionAndOrders(db: Database.Database) {
  const naanRecipe = db.prepare("SELECT id FROM recipes WHERE name LIKE 'Naan —%'").get() as { id: number };
  const kebabRecipe = db.prepare("SELECT id FROM recipes WHERE name LIKE 'Seekh Kebab%'").get() as { id: number };
  const rotiRecipe = db.prepare("SELECT id FROM recipes WHERE name LIKE 'Tandoori Roti%'").get() as { id: number };

  const naanBatch = startBatch(db, { recipeId: naanRecipe.id, plannedQty: 50, actor: "Chef Bilal", notes: "Lunch service" });
  completeBatch(db, naanBatch.id, "Chef Bilal");

  const kebabBatch = startBatch(db, { recipeId: kebabRecipe.id, plannedQty: 40, actor: "Chef Bilal", notes: "Friday dinner prep" });
  completeBatch(db, kebabBatch.id, "Chef Bilal");

  const rotiBatch = startBatch(db, { recipeId: rotiRecipe.id, plannedQty: 60, actor: "Chef Bilal", notes: "Weekend brunch" });
  db.prepare("UPDATE production_batches SET started_at = datetime('now', '-1 hours') WHERE id = ?").run(rotiBatch.id);

  const table = db.prepare("SELECT id FROM dining_tables WHERE code = 'T04'").get() as { id: number };
  const biryani = db
    .prepare(
      "SELECT mi.id AS item_id, mi.name, iv.id AS variant_id, iv.label, iv.size_ml, iv.price_cents FROM menu_items mi JOIN item_variants iv ON iv.item_id = mi.id WHERE mi.slug = 'chicken-biryani' AND iv.size_ml = 500",
    )
    .get() as { item_id: number; name: string; variant_id: number; label: string; size_ml: number; price_cents: number };
  const butterChicken = db
    .prepare(
      "SELECT mi.id AS item_id, mi.name, iv.id AS variant_id, iv.label, iv.size_ml, iv.price_cents FROM menu_items mi JOIN item_variants iv ON iv.item_id = mi.id WHERE mi.slug = 'butter-chicken' AND iv.size_ml = 500",
    )
    .get() as { item_id: number; name: string; variant_id: number; label: string; size_ml: number; price_cents: number };
  const naan = db
    .prepare(
      "SELECT mi.id AS item_id, mi.name, iv.id AS variant_id, iv.label, iv.size_ml, iv.price_cents FROM menu_items mi JOIN item_variants iv ON iv.item_id = mi.id WHERE mi.slug = 'garlic-naan'",
    )
    .get() as { item_id: number; name: string; variant_id: number; label: string; size_ml: number; price_cents: number };
  const lassi = db
    .prepare(
      "SELECT mi.id AS item_id, mi.name, iv.id AS variant_id, iv.label, iv.size_ml, iv.price_cents FROM menu_items mi JOIN item_variants iv ON iv.item_id = mi.id WHERE mi.slug = 'mango-lassi' AND iv.size_ml = 500",
    )
    .get() as { item_id: number; name: string; variant_id: number; label: string; size_ml: number; price_cents: number };

  const insertOrder = db.prepare(
    `INSERT INTO orders (code, channel, table_id, customer_name, phone, email, address, suburb, postcode, notes,
      subtotal_cents, surcharge_cents, surcharge_detail, priority, priority_fee_cents, delivery_fee_cents,
      delivery_cost_cents, total_cents, payment_method, payment_status, payment_ref, status, progress,
      created_at, updated_at, confirmed_at, kitchen_started_at, ready_at, dispatched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), ?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label, size_ml, spice_level, qty,
      unit_price_cents, line_total_cents, notes, prep_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvent = db.prepare(
    "INSERT INTO order_events (order_id, type, message, actor, progress, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))",
  );

  type DemoOrder = {
    code: string;
    channel: string;
    tableId?: number;
    name: string;
    phone: string;
    address?: string;
    suburb?: string;
    postcode?: string;
    status: string;
    progress: number;
    paymentMethod: string;
    paymentStatus: string;
    paymentRef?: string;
    items: { row: typeof biryani; qty: number; spice: string; state: string }[];
    priority?: boolean;
    priorityFee?: number;
    deliveryFee?: number;
    deliveryCost?: number;
    surcharge?: number;
    ageMinutes: number;
    events: [string, string, string][];
  };

  const demos: DemoOrder[] = [
    {
      code: "KB-DEMO01",
      channel: "delivery",
      name: "Ayesha Khan",
      phone: "0412 345 678",
      address: "12/48 Pirrama Road",
      suburb: "Pyrmont",
      postcode: "2009",
      status: "pending_confirm",
      progress: 5,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentRef: "sim_pi_demo01",
      priority: true,
      priorityFee: 250,
      deliveryFee: 649,
      deliveryCost: 560,
      ageMinutes: 4,
      items: [
        { row: biryani, qty: 1, spice: "hot", state: "queued" },
        { row: naan, qty: 2, spice: "", state: "queued" },
        { row: lassi, qty: 1, spice: "", state: "queued" },
      ],
      events: [["created", "Order placed — delivery", "customer"]],
    },
    {
      code: "KB-DEMO02",
      channel: "table",
      tableId: table.id,
      name: "Table 4",
      phone: "0400 111 222",
      status: "preparing",
      progress: 47,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentRef: "sim_pi_demo02",
      ageMinutes: 14,
      items: [
        { row: butterChicken, qty: 2, spice: "mild", state: "ready" },
        { row: naan, qty: 4, spice: "", state: "preparing" },
      ],
      events: [
        ["created", "Order placed — table order", "customer"],
        ["confirmed", "Order accepted by the counter — sent to the kitchen display", "Imran Shah"],
        ["kitchen_started", "Kitchen started preparation", "Chef Bilal"],
        ["item_ready", "Butter Chicken (500 ml) is ready — 1/2 items complete", "Chef Bilal"],
      ],
    },
    {
      code: "KB-DEMO03",
      channel: "pickup",
      name: "Daniel Mercer",
      phone: "0433 987 654",
      status: "awaiting_collection",
      progress: 88,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentRef: "sim_pi_demo03",
      ageMinutes: 26,
      items: [{ row: biryani, qty: 2, spice: "extra_hot", state: "ready" }],
      events: [
        ["created", "Order placed — click & collect", "customer"],
        ["confirmed", "Order accepted by the counter — sent to the kitchen display", "Imran Shah"],
        ["kitchen_started", "Kitchen started preparation", "Chef Bilal"],
        ["ready", "Ready for collection at the counter", "Chef Bilal"],
      ],
    },
    {
      code: "KB-DEMO04",
      channel: "delivery",
      name: "Priya Shah",
      phone: "0455 222 111",
      address: "803/1 Darling Drive",
      suburb: "Darling Harbour",
      postcode: "2000",
      status: "ready",
      progress: 85,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentRef: "sim_pi_demo04",
      deliveryFee: 699,
      deliveryCost: 605,
      ageMinutes: 22,
      items: [
        { row: butterChicken, qty: 1, spice: "hot", state: "ready" },
        { row: biryani, qty: 1, spice: "mild", state: "ready" },
        { row: naan, qty: 3, spice: "", state: "ready" },
      ],
      events: [
        ["created", "Order placed — delivery", "customer"],
        ["confirmed", "Order accepted by the counter — sent to the kitchen display", "Imran Shah"],
        ["kitchen_started", "Kitchen started preparation", "Chef Bilal"],
        ["ready", "Packed and ready — waiting for the delivery coordinator", "Chef Bilal"],
      ],
    },
    {
      code: "KB-DEMO05",
      channel: "dine_in",
      name: "Walk-in — 2 guests",
      phone: "",
      status: "pending_confirm",
      progress: 5,
      paymentMethod: "counter",
      paymentStatus: "unpaid",
      ageMinutes: 2,
      items: [
        { row: butterChicken, qty: 1, spice: "blend", state: "queued" },
        { row: naan, qty: 2, spice: "", state: "queued" },
      ],
      events: [["created", "Order placed — dine in", "counter"]],
    },
  ];

  for (const demo of demos) {
    const subtotal = demo.items.reduce((sum, item) => sum + item.row.price_cents * item.qty, 0);
    const surcharge = demo.surcharge ?? 0;
    const priorityFee = demo.priorityFee ?? 0;
    const deliveryFee = demo.deliveryFee ?? 0;
    const total = subtotal + surcharge + priorityFee + deliveryFee;
    const info = insertOrder.run(
      demo.code,
      demo.channel,
      demo.tableId ?? null,
      demo.name,
      demo.phone || null,
      null,
      demo.address ?? null,
      demo.suburb ?? null,
      demo.postcode ?? null,
      null,
      subtotal,
      surcharge,
      "[]",
      demo.priority ? 1 : 0,
      priorityFee,
      deliveryFee,
      demo.deliveryCost ?? 0,
      total,
      demo.paymentMethod,
      demo.paymentStatus,
      demo.paymentRef ?? null,
      demo.status,
      demo.progress,
      `-${demo.ageMinutes} minutes`,
      `-${demo.ageMinutes} minutes`,
      demo.status === "pending_confirm" ? null : `-${Math.max(1, demo.ageMinutes - 2)} minutes`,
      demo.status === "preparing" ? `-${Math.max(1, demo.ageMinutes - 3)} minutes` : null,
      ["ready", "awaiting_collection", "out_for_delivery", "completed"].includes(demo.status)
        ? `-${Math.max(1, demo.ageMinutes - 8)} minutes`
        : null,
      null,
    );
    const orderId = Number(info.lastInsertRowid);
    for (const item of demo.items) {
      insertItem.run(
        orderId,
        item.row.item_id,
        item.row.variant_id,
        item.row.name,
        item.row.label,
        item.row.size_ml,
        item.spice || null,
        item.qty,
        item.row.price_cents,
        item.row.price_cents * item.qty,
        null,
        item.state,
      );
    }
    demo.events.forEach((event, index) => {
      insertEvent.run(orderId, event[0], event[1], event[2], null, `-${Math.max(1, demo.ageMinutes - index * 3)} minutes`);
    });
    db.prepare(
      "INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, last4, paid_at) VALUES (?, 'simulated', ?, ?, 'paid', 'card', '4242', datetime('now'))",
    ).run(orderId, demo.paymentRef ?? `sim_pi_${demo.code}`, total);

    if (demo.channel === "delivery") {
      db.prepare(
        `INSERT INTO delivery_jobs (order_id, provider, provider_quote_id, cost_cents, customer_fee_cents, markup_cents,
          status, eta_minutes, quote_json, created_at)
         VALUES (?, 'simulated', ?, ?, ?, ?, 'quoted', 32, '{}', datetime('now', ?))`,
      ).run(
        orderId,
        `sim_q_${demo.code.toLowerCase()}`,
        demo.deliveryCost ?? 0,
        deliveryFee,
        deliveryFee - (demo.deliveryCost ?? 0),
        `-${demo.ageMinutes} minutes`,
      );
    }
  }

  // A completed delivery from earlier today, so reports have history.
  db.prepare(
    `INSERT INTO orders (code, channel, customer_name, phone, address, suburb, postcode, subtotal_cents, surcharge_cents,
      surcharge_detail, priority, priority_fee_cents, delivery_fee_cents, delivery_cost_cents, total_cents,
      payment_method, payment_status, payment_ref, status, progress, created_at, updated_at, confirmed_at,
      kitchen_started_at, ready_at, dispatched_at, completed_at)
     VALUES ('KB-DEMO06', 'delivery', 'Michael Rourke', '0466 555 444', '25 Harris Street', 'Pyrmont', '2009',
      4198, 0, '[]', 0, 0, 649, 555, 4847, 'online', 'paid', 'sim_pi_demo06', 'completed', 100,
      datetime('now', '-4 hours'), datetime('now', '-3 hours'), datetime('now', '-4 hours'), datetime('now', '-4 hours'),
      datetime('now', '-3 hours'), datetime('now', '-3 hours'), datetime('now', '-2 hours'))`,
  ).run();
  const completedId = Number(
    (db.prepare("SELECT id FROM orders WHERE code = 'KB-DEMO06'").get() as { id: number }).id,
  );
  db.prepare(
    "INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label, size_ml, spice_level, qty, unit_price_cents, line_total_cents, prep_state) VALUES (?, ?, ?, 'Family Feast Platter', '1 platter', NULL, 'hot', 1, 4799, 4799, 'ready')",
  ).run(completedId, butterChicken.item_id, butterChicken.variant_id);
  db.prepare(
    "INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, last4, paid_at) VALUES (?, 'simulated', 'sim_pi_demo06', 4847, 'paid', 'card', '4242', datetime('now', '-3 hours'))",
  ).run(completedId);
  db.prepare(
    "INSERT INTO delivery_jobs (order_id, provider, provider_quote_id, provider_delivery_id, cost_cents, customer_fee_cents, markup_cents, status, courier_name, eta_minutes, dispatched_at, completed_at) VALUES (?, 'simulated', 'sim_q_demo06', 'sim_d_demo06', 555, 649, 94, 'delivered', 'Adeel K.', 31, datetime('now', '-3 hours'), datetime('now', '-2 hours'))",
  ).run(completedId);
  db.prepare(
    "INSERT INTO order_events (order_id, type, message, actor, progress, created_at) VALUES (?, 'completed', 'Delivered — enjoy your meal', 'system', 100, datetime('now', '-2 hours'))",
  ).run(completedId);
}
