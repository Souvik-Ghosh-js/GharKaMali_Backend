const path = require('path');

class AiService {
  constructor() {
    this.classifier = null;
    this.modelName = 'Xenova/mobilenet-v2'; // Lightweight (~25MB)
  }

  async loadModel() {
    if (!this.classifier) {
      console.log(`[AI] Loading model: ${this.modelName}...`);
      
      // Dynamic import to support ESM-only library in CommonJS
      const { pipeline, env } = await import('@xenova/transformers');
      
      env.allowRemoteModels = true; 
      
      this.classifier = await pipeline('image-classification', this.modelName);
      console.log('[AI] Model loaded successfully');
    }
  }

  async identify(imagePath) {
    try {
      await this.loadModel();
      
      console.log(`[AI] Analyzing image: ${path.basename(imagePath)}`);
      const results = await this.classifier(imagePath, { topk: 3 });
      
      const topResult = results[0];
      const label = topResult.label.toLowerCase();
      
      // Get detailed metadata matching the label
      const metadata = this.getMetadata(label);
      
      return {
        plant_name: metadata.plant_name || this.formatLabel(topResult.label),
        scientific_name: metadata.scientific_name || topResult.label,
        description: metadata.description || `Identifying this as ${topResult.label}. This is part of a large family of plants.`,
        care_instructions: metadata.care_instructions || {
          watering: 'Water when top soil is dry',
          sunlight: 'Avoid direct afternoon sun',
          soil: 'Standard well-draining potting mix'
        },
        watering_schedule: metadata.watering_schedule || 'Check every 3-4 days',
        fertilizer_tips: metadata.fertilizer_tips || 'Use liquid fertilizer once a month in growing season',
        sunlight_requirement: metadata.sunlight_requirement || 'Indirect Sunlight',
        confidence_score: (topResult.score * 100).toFixed(1)
      };
    } catch (err) {
      console.error('[AI Error]', err);
      throw err;
    }
  }

  formatLabel(label) {
    return label.split(',')[0].split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  getMetadata(label) {
    // Extensive botanical mapping for common plants
    const dictionary = {
      'pothos': {
        plant_name: 'Money Plant (Pothos)',
        scientific_name: 'Epipremnum aureum',
        description: 'A popular houseplant known for its heart-shaped leaves and ability to thrive in low light. Extremely hardy and easy to grow.',
        watering_schedule: 'Every 5-7 days',
        sunlight_requirement: 'Low to Medium Indirect',
        care_instructions: { watering: 'Allow soil to dry out between waterings', sunlight: 'Thrives in indirect light', soil: 'Well-drained soil' }
      },
      'snake plant': {
        plant_name: 'Snake Plant (Sansevieria)',
        scientific_name: 'Dracaena trifasciata',
        description: 'An architectural plant that is almost indestructible. It is famous for filtering indoor air and surviving low light conditions.',
        watering_schedule: 'Every 15-20 days',
        sunlight_requirement: 'Low to Direct',
        care_instructions: { watering: 'Water sparingly, only when dry', sunlight: 'Can handle any light from dark to full sun', soil: 'Cactus or succulent mix' }
      },
      'monstera': {
        plant_name: 'Swiss Cheese Plant (Monstera)',
        scientific_name: 'Monstera deliciosa',
        description: 'Iconic tropical plant with characteristic split leaves. It adds a bold, jungle feel to any indoor space.',
        watering_schedule: 'Once a week',
        sunlight_requirement: 'Bright Indirect',
        care_instructions: { watering: 'Keep soil moist but not soggy', sunlight: 'Bright indirect light increases leaf splits', soil: 'Peat-based potting mix' }
      },
      'succulent': {
        plant_name: 'Succulent',
        scientific_name: 'Echeveria spp.',
        description: 'Thick-leaved plants that store water, making them perfect for sunny windows and dry environments.',
        watering_schedule: 'Every 10-14 days',
        sunlight_requirement: 'Bright Direct',
        care_instructions: { watering: 'Soak and dry method', sunlight: 'Needs at least 4-6 hours of sun', soil: 'Gritty, fast-draining soil' }
      },
      'rose': {
        plant_name: 'Rose',
        scientific_name: 'Rosa',
        description: 'Classic flowering shrub prized for its fragrance and beauty. Requires dedicated care but very rewarding.',
        watering_schedule: 'Every 2-3 days',
        sunlight_requirement: 'Full Sun',
        care_instructions: { watering: 'Water at the base to avoid leaf rot', sunlight: 'At least 6 hours of full sun', soil: 'Rich, loamy soil' }
      }
    };

    // Semi-fuzzy matching
    for (const key in dictionary) {
      if (label.includes(key)) return dictionary[key];
    }

    return {};
  }
}

module.exports = new AiService();
