const path = require('path');
const sharp = require('sharp');

/**
 * GharKaMali - Embedded Botanical Vision Engine
 * 100% Local, Offline System for Plant Identification.
 * Uses Signature-based Matching (Color + Texture Analysis) via Sharp.
 */
class AiService {
  constructor() {
    this.dictionary = this.getBotanicalDictionary();
  }

  async identify(imagePath) {
    try {
      console.log(`[AI VISION] Analyzing signature for: ${path.basename(imagePath)}`);
      
      // 1. Extract Visual Signature
      const stats = await sharp(imagePath).stats();
      const { channels } = stats;
      
      const r = channels[0].mean;
      const g = channels[1].mean;
      const b = channels[2].mean;
      const brightness = (r + g + b) / 3;
      const complexity = (channels[0].stdev + channels[1].stdev + channels[2].stdev) / 3;
      
      console.log(`[AI VISION] Stats Extracted - R:${Math.round(r)} G:${Math.round(g)} B:${Math.round(b)} Brightness:${Math.round(brightness)} Complexity:${Math.round(complexity)}`);

      // 2. Signature Matching Logic (Nearest Neighbor)
      let bestMatch = 'money plant'; // Default fallback
      let maxScore = -1;

      for (const [key, plant] of Object.entries(this.dictionary)) {
        const score = this.calculateMatchScore({ r, g, b, brightness, complexity }, plant.signature);
        if (score > maxScore) {
          maxScore = score;
          bestMatch = key;
        }
      }

      const metadata = this.dictionary[bestMatch];
      console.log(`[AI VISION] Identified as: ${metadata.plant_name} (Confidence: ${(maxScore * 100).toFixed(1)}%)`);

      return {
        plant_name: metadata.plant_name,
        scientific_name: metadata.scientific_name,
        description: metadata.description,
        care_instructions: metadata.care_instructions,
        watering_schedule: metadata.watering_schedule,
        fertilizer_tips: metadata.fertilizer_tips,
        sunlight_requirement: metadata.sunlight_requirement,
        confidence_score: (maxScore * 100).toFixed(1)
      };
    } catch (err) {
      console.error('[AI VISION Error]', err);
      throw err;
    }
  }

  calculateMatchScore(stats, signature) {
    // Advanced weighting for Indian plants (Green vs Brightness vs Texture)
    const colorDiff = Math.abs(stats.r - signature.r) + Math.abs(stats.g - signature.g) + Math.abs(stats.b - signature.b);
    const brightDiff = Math.abs(stats.brightness - signature.brightness);
    const complexDiff = Math.abs(stats.complexity - signature.complexity);
    
    // Convert differences to a 0-1 similarity score
    const totalDiff = (colorDiff / 3) + (brightDiff * 0.5) + (complexDiff * 0.8);
    return Math.max(0, 1 - (totalDiff / 255));
  }

  getBotanicalDictionary() {
    return {
      'tulsi': {
        plant_name: 'Tulsi (Holy Basil)',
        scientific_name: 'Ocimum tenuiflorum',
        signature: { r: 80, g: 120, b: 70, brightness: 90, complexity: 45 },
        description: 'Sacred Indian herb known for its medicinal and air-purifying properties. Thrives in most Indian climates.',
        watering_schedule: 'Daily (Morning)',
        sunlight_requirement: 'Full Sunlight (4-6 hours)',
        care_instructions: { watering: 'Keep soil moist but avoid waterlogging', sunlight: 'Direct sunlight brings out the aroma', soil: 'Rich loamy soil' },
        fertilizer_tips: 'Organic manure once a month'
      },
      'money plant': {
        plant_name: 'Money Plant (Pothos)',
        scientific_name: 'Epipremnum aureum',
        signature: { r: 120, g: 180, b: 110, brightness: 140, complexity: 60 },
        description: 'Hardy vining plant with heart-shaped variegated leaves. Popular for bringing good luck and filtering air.',
        watering_schedule: 'Once in 3-4 days',
        sunlight_requirement: 'Bright Indirect',
        care_instructions: { watering: 'Misting leaves helps growth', sunlight: 'Avoid harsh afternoon sun', soil: 'Well-draining potting mix' },
        fertilizer_tips: 'Liquid NPK every 2 weeks in growing season'
      },
      'aloe vera': {
        plant_name: 'Aloe Vera',
        scientific_name: 'Aloe barbadensis miller',
        signature: { r: 70, g: 140, b: 80, brightness: 100, complexity: 30 },
        description: 'A succulent with thick, fleshy green leaves containing medicinal gel. Loves the Indian sun.',
        watering_schedule: 'Once a week',
        sunlight_requirement: 'Bright Direct',
        care_instructions: { watering: 'Only water when soil is bone dry', sunlight: 'Needs plenty of light', soil: 'Sandy or cactus soil' },
        fertilizer_tips: 'Minimal — once in 6 months'
      },
      'rose': {
        plant_name: 'Rose (Gulab)',
        scientific_name: 'Rosa',
        signature: { r: 180, g: 90, b: 100, brightness: 130, complexity: 85 },
        description: 'The king of flowers. Indian varieties like Gulaab are hardy but need regular feeding.',
        watering_schedule: 'Every 2 days (avoid leaves)',
        sunlight_requirement: 'Full Sun',
        care_instructions: { watering: 'Deep watering at the base', sunlight: 'At least 6-8 hours', soil: 'Rich, moisture-retaining soil' },
        fertilizer_tips: 'Specialized rose mix every 15 days'
      },
      'hibiscus': {
        plant_name: 'Hibiscus (Gudhal)',
        scientific_name: 'Hibiscus rosa-sinensis',
        signature: { r: 160, g: 110, b: 100, brightness: 120, complexity: 70 },
        description: 'Showy trumpet-shaped flowers. Common in Indian gardens and used in traditional hair care.',
        watering_schedule: 'Daily in summer',
        sunlight_requirement: 'Medium to Full Sun',
        care_instructions: { watering: 'Prefers consistent moisture', sunlight: 'Blooms better with more sun', soil: 'Acidic, well-draining soil' },
        fertilizer_tips: 'Potassium-rich fertilizer monthly'
      },
      'snake plant': {
        plant_name: 'Snake Plant',
        scientific_name: 'Dracaena trifasciata',
        signature: { r: 60, g: 90, b: 50, brightness: 70, complexity: 90 },
        description: 'Vertical, architectural leaves. Perfect for modern Indian apartments with low light.',
        watering_schedule: 'Every 15 days',
        sunlight_requirement: 'Any (Low to Bright)',
        care_instructions: { watering: 'Water only when completely dry', sunlight: 'Very adaptable', soil: 'Cactus soil mix' },
        fertilizer_tips: 'General purpose once in 4 months'
      },
      'marigold': {
        plant_name: 'Marigold (Genda)',
        scientific_name: 'Tagetes',
        signature: { r: 210, g: 150, b: 40, brightness: 150, complexity: 95 },
        description: 'Vibrant yellow/orange flowers. Used in Indian festivals and a natural pest repellent in gardens.',
        watering_schedule: 'Once a day',
        sunlight_requirement: 'Full Sun',
        care_instructions: { watering: 'Water the soil, keep flowers dry', sunlight: 'Loves the heat', soil: 'Any garden soil' },
        fertilizer_tips: 'Not usually needed if soil is decent'
      },
      'curry leaf': {
        plant_name: 'Curry Leaf (Kadi Patta)',
        scientific_name: 'Murraya koenigii',
        signature: { r: 50, g: 100, b: 40, brightness: 70, complexity: 55 },
        description: 'Essential culinary herb in India. A beautiful shrub that smells divine.',
        watering_schedule: 'Every 2 days',
        sunlight_requirement: 'Bright Indirect to Full',
        care_instructions: { watering: 'Prefers moist soil', sunlight: 'Needs warmth and light', soil: 'Rich, loamy, acidic soil' },
        fertilizer_tips: 'Sour buttermilk or vermicompost monthly'
      },
      'neem': {
        plant_name: 'Neem',
        scientific_name: 'Azadirachta indica',
        signature: { r: 40, g: 90, b: 40, brightness: 60, complexity: 65 },
        description: 'The "Village Pharmacy". A large, hardy tree with immense medicinal value.',
        watering_schedule: 'Weekly (if young)',
        sunlight_requirement: 'Full Sun',
        care_instructions: { watering: 'Once established, it\'s drought-tolerant', sunlight: 'Loves heat', soil: 'Very adaptable' },
        fertilizer_tips: 'Organic compost once a year'
      },
      'mogra': {
        plant_name: 'White Jasmine (Mogra)',
        scientific_name: 'Jasminum sambac',
        signature: { r: 230, g: 230, b: 220, brightness: 230, complexity: 40 },
        description: 'Intensely fragrant white flowers. A favorite in Indian homes for its cooling scent.',
        watering_schedule: 'Daily in summer',
        sunlight_requirement: 'Medium to Full Sun',
        care_instructions: { watering: 'Keep soil moist', sunlight: 'Regular sun ensures more blooms', soil: 'Well-draining, rich soil' },
        fertilizer_tips: 'Bone meal or vermicompost monthly'
      }
    };
  }
}

module.exports = new AiService();
