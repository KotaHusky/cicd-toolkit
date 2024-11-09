# Reusable Code Analysis Workflow with ChatGPT

This repository provides a reusable GitHub Actions workflow for performing code analysis with ChatGPT. The workflow is designed to analyze code for engineering excellence principles, such as SOLID, and provides feedback directly within pull requests.

## Features

- **Central Configuration**: Easily manage file size limits, approved file types, directories, and exclusions through a configuration file.
- **TSDoc and Comment Parsing**: Supports JavaScript and Python files with comment-based documentation.
- **Rate Limiting**: Enforces hourly rate limits to control ChatGPT API usage.
- **Customizable Directory and Exclusions**: Allows consumers to specify their own analysis directory and exclusions.
- **API Key Security**: Requires each consumer to provide their own OpenAI API key, ensuring secure and private usage.

## Contents

- [Reusable Code Analysis Workflow with ChatGPT](#reusable-code-analysis-workflow-with-chatgpt)
  - [Features](#features)
  - [Contents](#contents)
  - [Installation](#installation)
  - [Configuration](#configuration)
    - [Example Configuration File](#example-configuration-file)
  - [Usage](#usage)
    - [Example: Basic Setup](#example-basic-setup)
    - [Example: Custom Directory and Exclusions](#example-custom-directory-and-exclusions)
  - [Security](#security)
  - [FAQ](#faq)

## Installation

1. **Clone the Repository**: Clone this repository or copy the workflow files to your own repository.

2. **Configure GitHub Secrets**: Add an `OPENAI_API_KEY` secret in your GitHub repository with your OpenAI API key.

   - Go to **Settings > Secrets and variables > Actions** in your GitHub repository.
   - Click **New repository secret** and add `OPENAI_API_KEY`.

3. **Add the Reusable Workflow**: Save the reusable workflow in your repository under `.github/workflows/code_analysis.yml`.

4. **Add the Action Script**: Ensure that `code_analysis_with_gitignore_exclude.js` is located in `.github/actions/`.

## Configuration

The reusable workflow uses a centralized configuration file (`code_analysis_config.yml`) located at `.github/config/code_analysis_config.yml`. This file sets default values for the analysis, including approved file types, maximum file size, default directory, and exclusions.

### Example Configuration File

```yaml
# .github/config/code_analysis_config.yml
max_size_mb: 1                       # Maximum combined size of files to analyze, in MB
approved_types: ['.js', '.py']        # Approved file types for analysis
directory: '.github/actions'          # Default directory for analysis
exclude: 'tests/**,*.test.js'         # Default exclude patterns for testing
max_calls_per_hour: 3                 # Maximum ChatGPT API calls per hour
```

- **max_size_mb**: Sets the maximum size of files for analysis.
- **approved_types**: Lists the approved file types (e.g., JavaScript and Python).
- **directory**: Default directory for analysis (can be overridden in workflows).
- **exclude**: Default exclude patterns in `.gitignore` style (optional override).
- **max_calls_per_hour**: Limits the number of API calls per hour.

## Usage

To use the reusable workflow, define a workflow in your repository and include the `code_analysis.yml` workflow with `workflow_call`.

### Example: Basic Setup

```yaml
name: Code Analysis with ChatGPT

on:
  pull_request:
    branches:
      - '**'

jobs:
  code_analysis:
    uses: ./.github/workflows/code_analysis.yml
    with:
      openai_api_key: ${{ secrets.OPENAI_API_KEY }}  # Mandatory: Provide your own API key
```

This setup will:
- Use the default settings in `code_analysis_config.yml`.
- Analyze code on every pull request.

### Example: Custom Directory and Exclusions

You can also customize the `directory` and `exclude` inputs if you want the analysis to target specific files or folders.

```yaml
name: Custom Code Analysis with ChatGPT

on:
  pull_request:
    branches:
      - '**'

jobs:
  custom_code_analysis:
    uses: ./.github/workflows/code_analysis.yml
    with:
      openai_api_key: ${{ secrets.OPENAI_API_KEY }}    # Mandatory: Provide your own API key
      directory: 'src'                                 # Optional: Override directory for analysis
      exclude: 'docs/**,*.md'                          # Optional: Exclude documentation files
```

In this example:
- The analysis will target the `src` directory.
- Files in the `docs` directory and Markdown files are excluded.

## Security

**Important**: This reusable workflow requires consumers to provide their own OpenAI API key. Your API key is not shared or accessible by others using this workflow.

- **API Key Requirement**: Every user must add their own `OPENAI_API_KEY` secret to use this workflow.
- **Rate Limiting**: The configuration file enforces an hourly rate limit to control API usage and prevent unexpected costs.

## FAQ

**Q: Why do I need to provide my own OpenAI API key?**  
A: This workflow is reusable, meaning other users can implement it in their repositories. Requiring each user to supply their own API key ensures security and privacy.

**Q: Can I override the defaults in `code_analysis_config.yml`?**  
A: Yes, you can specify custom values for `directory` and `exclude` as inputs in your workflow. However, other settings like `max_size_mb` and `approved_types` are fixed in the configuration file.

**Q: How do I check if the rate limit is working?**  
A: The workflow logs will show messages when the maximum number of API calls per hour has been reached, skipping further calls until the limit resets.
