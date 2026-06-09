# TheoKit Workflow Automation

A scheduled multi-step workflow that fetches data, processes it through an agent for analysis, and outputs a formatted report. Uses `Cron.create` for recurring execution and demonstrates how to wire agent processing into automated pipelines.

## Usage

```bash
export THEOKIT_API_KEY="your-key"

# Run the workflow (executes once immediately, then on cron schedule)
npx tsx src/index.ts
```
