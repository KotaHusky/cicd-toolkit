const fs = require('fs');
const yaml = require('js-yaml');

// Load central configuration file
const config = yaml.load(fs.readFileSync('.github/config/code_analysis_config.yml', 'utf8'));

// Set environment variables
console.log(`MAX_SIZE_MB=${config.max_size_mb}`);
console.log(`APPROVED_TYPES=${config.approved_types.join(',')}`);
console.log(`MAX_CALLS_PER_HOUR=${config.max_calls_per_hour}`);

// Check for directory and exclude inputs; otherwise, use config values
const directory = process.env.DIRECTORY || config.directory;
const exclude = process.env.EXCLUDE || config.exclude;

console.log(`DIRECTORY=${directory}`);
console.log(`EXCLUDE=${exclude}`);
