const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const minimatch = require('minimatch');

const approvedTypes = process.env.APPROVED_TYPES.split(',');
const maxSizeBytes = parseInt(process.env.MAX_SIZE_MB) * 1024 * 1024;
const maxCallsPerHour = parseInt(process.env.MAX_CALLS_PER_HOUR) || 3;
const directory = process.env.DIRECTORY;
const excludePatterns = process.env.EXCLUDE ? process.env.EXCLUDE.split(',') : [];
const openaiApiKey = process.env.OPENAI_API_KEY;
const callCountFile = path.join('.github/actions/hourly_call_count.json');
const oneHour = 60 * 60 * 1000;

/**
 * Generates a unique hash for each API call.
 *
 * @returns {string} A unique 12-character hash.
 */
function generateUniqueHash() {
  return crypto.createHash('md5').update(Date.now().toString() + Math.random().toString()).digest('hex').slice(0, 12);
}

/**
 * Retrieves the current call count, filtering out entries older than one hour.
 *
 * @returns {{count: number, calls: Array<{hash: string, timestamp: number}>}}
 * The current count and an array of recent call entries.
 */
function getHourlyCallCount() {
  if (!fs.existsSync(callCountFile)) {
    return { count: 0, calls: [] };
  }

  const data = JSON.parse(fs.readFileSync(callCountFile, 'utf8'));
  const currentTime = Date.now();

  // Filter to keep only calls within the last hour
  const recentCalls = data.calls.filter(call => currentTime - call.timestamp < oneHour);

  return {
    count: recentCalls.length,
    calls: recentCalls
  };
}

/**
 * Updates the call count file with a new API call entry and applies the sliding window.
 */
function updateHourlyCallCount() {
  const currentData = getHourlyCallCount();
  const newCall = {
    hash: generateUniqueHash(),
    timestamp: Date.now()
  };

  // Add new call and reapply the sliding window to keep only recent calls
  currentData.calls.push(newCall);
  const recentCalls = currentData.calls.filter(call => Date.now() - call.timestamp < oneHour);

  // Update count and calls in the JSON file
  currentData.count = recentCalls.length;
  currentData.calls = recentCalls;

  fs.writeFileSync(callCountFile, JSON.stringify(currentData, null, 2));
}

/**
 * Checks if a file path matches any of the exclude patterns.
 *
 * @param {string} filePath - The path of the file to check.
 * @returns {boolean} True if the file should be excluded, false otherwise.
 */
function isExcluded(filePath) {
  return excludePatterns.some(pattern => minimatch(filePath, pattern.trim()));
}

/**
 * Loads files from the specified directory, applying filters for approved types and exclusions.
 *
 * @returns {{combinedText: string, totalSize: number}} The combined content of approved files and the total size.
 */
function loadApprovedFiles() {
  let combinedText = '';
  let totalSize = 0;

  const files = fs.readdirSync(directory).filter(file => {
    const filePath = path.join(directory, file);
    return approvedTypes.includes(path.extname(file)) && !isExcluded(filePath);
  });

  for (const file of files) {
    const filePath = path.join(directory, file);
    const fileSize = fs.statSync(filePath).size;

    if (totalSize + fileSize > maxSizeBytes) {
      console.log(`Skipping file ${filePath} (size exceeds limit)`);
      continue;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    combinedText += `\n### File: ${filePath} ###\n\n${fileContent}\n`;
    totalSize += fileSize;

    if (totalSize >= maxSizeBytes) {
      console.log(`Total size limit reached at ${totalSize} bytes.`);
      break;
    }
  }

  console.log(`Total content size: ${totalSize} bytes`);
  return { combinedText, totalSize };
}

/**
 * Sends code content to the ChatGPT API for analysis and logs the API response.
 *
 * @param {string} inputText - The code content to analyze.
 * @returns {Promise<string>} The response from the ChatGPT API.
 */
async function getAIFindings(inputText) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a code review assistant.' },
        { role: 'user', content: `Analyze the following code:\n\n${inputText}` }
      ]
    },
    { headers: { Authorization: `Bearer ${openaiApiKey}` } }
  );

  return response.data.choices[0].message.content;
}

/**
 * Main function to control workflow: loads files, checks rate limits, and analyzes code with ChatGPT.
 */
async function main() {
  const { count } = getHourlyCallCount();

  if (count >= maxCallsPerHour) {
    console.log(`Info: Maximum ChatGPT call limit of ${maxCallsPerHour} per hour reached. Skipping analysis.`);
    return;
  }

  const { combinedText, totalSize 
