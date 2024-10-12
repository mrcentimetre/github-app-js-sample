import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import { Octokit, App } from 'octokit';
import { createNodeMiddleware } from '@octokit/webhooks';

// Load environment variables from .env file
dotenv.config();

// Set configured values
const appId = process.env.APP_ID;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const secret = process.env.WEBHOOK_SECRET;
const enterpriseHostname = process.env.ENTERPRISE_HOSTNAME;
const messageForNewPRs = fs.readFileSync('./message.md', 'utf8');

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret,
  },
  ...(enterpriseHostname && {
    Octokit: Octokit.defaults({
      baseUrl: `https://${enterpriseHostname}/api/v3`,
    }),
  }),
});

// Optional: Get & log the authenticated app's name
const { data } = await app.octokit.request('/app');

// Read more about custom logging: https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`);

// Subscribe to the "pull_request.opened" webhook event
app.webhooks.on('pull_request.opened', async ({ octokit, payload }) => {
  const prNumber = payload.pull_request.number;
  const prTitle = payload.pull_request.title;
  const repoOwner = payload.repository.owner.login;
  const repoName = payload.repository.name;

  console.log(`Received a pull request event for #${prNumber}`);

  try {
    // Create a comment on the pull request
    await octokit.rest.issues.createComment({
      owner: repoOwner,
      repo: repoName,
      issue_number: prNumber,
      body: messageForNewPRs,
    });

    // Create a new issue to track the pull request (replicates the GitHub Action functionality)
    const issueTitle = `🎯 ${prTitle} - PR #${prNumber}`;
    const issueBody = `This issue is automatically created for tracking the tasks related to PR #${prNumber}.`;
    
    await octokit.rest.issues.create({
      owner: repoOwner,
      repo: repoName,
      title: issueTitle,
      body: issueBody,
      labels: ['pr-task'],  // You can customize the label as per your requirements
    });

    console.log(`Created tracking issue for PR #${prNumber}`);
  } catch (error) {
    if (error.response) {
      console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
    } else {
      console.error(error);
    }
  }
});

// Optional: Handle errors
app.webhooks.onError((error) => {
  if (error.name === 'AggregateError') {
    // Log Secret verification errors
    console.log(`Error processing request: ${error.event}`);
  } else {
    console.log(error);
  }
});

// Launch a web server to listen for GitHub webhooks
const port = process.env.PORT || 3000;
const path = '/api/webhook';
const localWebhookUrl = `http://localhost:${port}${path}`;

// See https://github.com/octokit/webhooks.js/#createnodemiddleware for all options
const middleware = createNodeMiddleware(app.webhooks, { path });

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`);
  console.log('Press Ctrl + C to quit.');
});
