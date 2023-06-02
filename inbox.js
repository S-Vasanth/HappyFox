const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const mysql = require('mysql');

// MySQL connection configuration
const connection = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "email",
});

// Load Gmail API credentials
const credentials = require('./credential.json');
const TOKEN_PATH = 'token.json';

// Load rules from JSON file
const rules = require('./rules.json').rules;

// Authenticate to Gmail API
function authenticate() {
  const client_secret="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"
  const client_id="1070782721609-sci6aan9gu4ujmnh889kvdb9elnirg87.apps.googleusercontent.com"
  redirect_uris =  [
    "http://localhost:5550/inbox"
]
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Check if we have a previously stored token
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client);
    oAuth2Client.setCredentials(JSON.parse(token));
    listEmails(oAuth2Client);
  });
}

// Get access token
function getAccessToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify'],
  });
  console.log('Authorize this app by visiting this URL:', authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      listEmails(oAuth2Client);
    });
  });
}

// Fetch emails from Gmail API and store them in the database
function listEmails(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  gmail.users.messages.list(
    {
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 50,
    },
    (err, res) => {
      if (err) return console.error('The API returned an error:', err.message);

      const emails = res.data.messages || [];
      console.log('Fetched', emails.length, 'emails');

      emails.forEach((email) => {
        gmail.users.messages.get({ userId: 'me', id: email.id }, (err, res) => {
          if (err) return console.error('Error fetching email:', err.message);
          //console.log(email)
          const emailData = res.data;
        
          const messageId = emailData.id;
          const threadId=emailData.id
          const label=emailData.labelIds
          const fromEmail = getEmailAddress(emailData, 'From');
          const toEmail = getEmailAddress(emailData, 'To');
          const subject = emailData.payload.headers.find((header) => header.name === 'Subject').value;
          const message = getMessageBody(emailData);
          const receivedDateTime = new Date(parseInt(emailData.internalDate));

          // Store email in the database
          const query = connection.query(
            'INSERT INTO emails SET ? ',
              {messageId:messageId,
               fromEmail:fromEmail, 
               toEmail:toEmail, 
               subject:subject, 
               message:message, 
               receivedDateTime:receivedDateTime},
            (err) => {
              if (err) return console.error('Error storing email:', err.message);
              console.log('Email stored:', messageId);
            }
          );
        });
      });
    }
  );
}

// Helper function to extract email address from email headers
function getEmailAddress(email, field) {
     const newEmail= email.payload.headers
    .filter((header) => header.name === field)
    .map((header) => header.value)
    .join(', ');
    const emailPattern = /<([^>]+)>/;

    // Extracting email using match and regex
    const match = newEmail.match(emailPattern);
    if (match && match.length > 1) {
      const email = match[1];
      return email
    }else{
      return email
   }
}

// Helper function to extract message body from email payload
function getMessageBody(email) {
  const body = email.payload.body;
  if (body.size && body.size > 0) {
    return Buffer.from(body.data, 'base64').toString();
  } else if (email.payload.parts) {
    return email.payload.parts
      .filter((part) => part.mimeType === 'text/plain')
      .map((part) => Buffer.from(part.body.data, 'base64').toString())
      .join('\n');
  }
  return '';
}

// Execute rules on emails
function executeRules() {
  connection.query('SELECT * FROM emails', (err, results) => {
    if (err) return console.error('Error retrieving emails from the database:', err.message);

    results.forEach((email) => {

      const matchingRules = rules.filter((rule) => checkConditions(rule.conditions, email));

      if (matchingRules.length > 0) {
        matchingRules.forEach((rule) => executeActions(rule.actions, email));
      }
    });

  });
}

// Check if conditions in a rule match the email
function checkConditions(conditions, email) {
  if (conditions.predicate === 'All') {
    return conditions.conditions.every((condition) => checkCondition(condition, email));
  } else if (conditions.predicate === 'Any') {
    return conditions.conditions.some((condition) => checkCondition(condition, email));
  }
  return false;
}

// Check if a single condition matches the email
function checkCondition(condition, email) {

  const fieldValue = email[condition.fieldName];
  const value = condition.value;

  switch (condition.predicate) {
    case 'Contains':
      return fieldValue.includes(value);
    case 'Does not Contain':
      return !fieldValue.includes(value);
    case 'Equals':
      return fieldValue === value;
    case 'Does not equal':
      return fieldValue !== value;
    case 'Less than':
      return fieldValue < value;
    case 'Greater than':
      return fieldValue > value;
    default:
      return false;
  }
}

// Execute actions on the email
function executeActions(actions, email) {
  const messageId = email.messageId;

  actions.forEach((action) => {
    switch (action) {
      case 'Mark as read':
        // Implement the logic to update the database and mark the email as read
        connection.query('UPDATE emails SET isRead = 1 WHERE messageId = ?', [messageId], (err) => {
          if (err) return console.error('Error marking email as read:', err.message);
          console.log('Email marked as read in the database:', messageId);
        });
        break;
      case 'Mark as unread':
        // Implement the logic to update the database and mark the email as unread
        connection.query('UPDATE emails SET isRead = 0 WHERE messageId = ?', [messageId], (err) => {
          if (err) return console.error('Error marking email as unread:', err.message);
          console.log('Email marked as unread in the database:', messageId);
        });
        break;
      case 'Archive message':
        // Implement the logic to update the database and archive the email
        connection.query('UPDATE emails SET isArchived = 1 WHERE messageId = ?', [messageId], (err) => {
          if (err) return console.error('Error archiving email:', err.message);
          console.log('Email archived in the database:', messageId);
        });
        break;
      case 'Add label':
        // Implement the logic to update the database and add a label to the email
        connection.query('UPDATE emails SET label = ? WHERE messageId = ?', ['Jobs', messageId], (err) => {
          if (err) return console.error('Error adding label to email:', err.message);
          console.log('Label added to email in the database:', messageId);
        });
        break;
      default:
        break;
    }
  });
}


module.exports = {
  authenticate,
  executeRules,
};
