//
// This is main file containing code implementing the Express server and functionality for the Express echo bot.
//
'use strict';
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
//const path = require('path');
require('dotenv').config();
var Datastore = require('nedb');
var messengerButton = "<html><head><title>Facebook Messenger Bot</title></head><body><h1>Facebook Messenger Bot</h1>This is a bot based on Messenger Platform QuickStart. For more details, see their <a href=\"https://developers.facebook.com/docs/messenger-platform/guides/quick-start\">docs</a>.<script src=\"https://button.glitch.me/button.js\" data-style=\"glitch\"></script><div class=\"glitchButton\" style=\"position:fixed;top:20px;right:20px;\"></div></body></html>";

// The rest of the code implements the routes for our Express server.
let app = express();
var groups = new Datastore({ filename: 'groups.db', autoload: true });
var users = new Datastore({ filename: 'users.db', autoload: true });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

// Simple home page
app.get('/', function(req, res) {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.write(messengerButton);
  res.end();
});




//---------------------------------
//   Facebook Side
//---------------------------------
//Webhook validation
app.get('/facebook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  }
  else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});

// Message processing
app.post('/facebook', function (req, res) {
  //console.log(req.body);
  var data = req.body;
  // Make sure this is a page subscription
  if (data.object === 'page') {
    // Iterate over each entry - there may be multiple if batched
    data.entry.forEach(function(entry) {
      //var pageID = entry.id;
      //var timeOfEvent = entry.time;
      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.message) {
          receivedMessage(event);
        } else if (event.postback) {
          receivedPostback(event);
        } else {
          console.log("Webhook received unknown event: ", event);
        }
      });
    });
    // Assume all went well.
    // You must send back a 200, within 20 seconds, to let us know
    // you've successfully received the callback. Otherwise, the request
    // will time out and we will keep trying to resend.
    res.sendStatus(200);
  }
});

// Message event
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  //var messageId = message.mid;

  var messageText = message.text;
  var messageAttachments = message.attachments;

  if (messageText) {
    users.findOne( { FB_ID: senderID }, function(err, doc){
        var inDB=false;
        if(doc != null){
            inDB = true;
        }
        if( !inDB ){
            SignIn(senderID);
        } else if( messageText.includes("/signin") ){
            sendTextMessage(senderID, "You must sign in with at least one Slack account");
            SignIn(senderID);
        } else{
            sendTextMessage(senderID, messageText);
        }
    } );
    } else if (messageAttachments) {
        sendTextMessage(senderID, "Message with attachment received");
  }
}

//Postback event
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;
  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;
  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);
  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful
  sendTextMessage(senderID, "Postback called");
}

//Send sign in link
function SignIn(recipientId){
    var messageData = {
      recipient: {
        id: recipientId
      },
      message:{
          attachment:{
              type:"template",
              payload:{
                  template_type:"button",
                  text:"Please sign in with slack to link your Facebook and Slack accounts.",
                  buttons:
                  [
                      {
                          type:"web_url",
                          url:"https://slack.com/oauth/authorize?scope=identity.basic&client_id=" + process.env.SLACK_CLIENT_ID + "&state=" + recipientId,
                          title:"Sign In"
                      }
                  ]
              }
          }
      }
  };

//url: "https://slack.com/oauth/authorize?scope=identity.basic&client_id=" + process.env.SLACK_CLIENT_ID,
    callSendAPI(messageData);
}

//Build and send basic text message
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}

//Send message to Facebook
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: process.env.PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s",
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });
}




//---------------------------------
//   Slack Side
//---------------------------------
//Slack events
app.post('/slack', function(req, res) {
    console.log(req);
  if (req.body.type === 'url_verification') {
    console.log("Validating Slack events");
    res.status(200).send(req.body.challenge);
  }
  else if(req.body.event.type === 'message') {
    //var channel = getChannelName(req.body.event.channel);
    //console.log("Channel: " + channel);
  }
});
//User authentication
app.get('/auth/redirect', function(req, res) {
    var options = {
        uri: 'https://slack.com/api/oauth.access?code='
            +req.query.code+
            '&client_id='+process.env.SLACK_CLIENT_ID+
            '&client_secret='+process.env.SLACK_CLIENT_SECRET,
        method: 'GET'
    }
    console.log(req.query.state);
    request(options, (error, response, body) => {
        var JSONresponse = JSON.parse(body)
        if (!JSONresponse.ok){
            console.log(JSONresponse);
            res.send("Error encountered: \n"+JSON.stringify(JSONresponse)).status(200).end();
        }else{
            console.log(JSONresponse);
            var user = {
                FB_ID: req.query.state,
                SLACK_DATA: [ {ID: JSONresponse.user.id, TOKEN: JSONresponse.access_token} ]
            };
            users.findOne( { FB_ID: req.query.state }, function(err, doc){
                if(doc === null){
                    users.insert( user, function(){} );
                } else{
                    users.update( { FB_ID: req.query.state }, { $addToSet: { SLACK_DATA: { ID: JSONresponse.user.id, TOKEN: JSONresponse.access_token } } }, {}, function (){} );
                }
            } );
            res.send("Success!");
        }
    })
});












function getChannelName(channelID){
    request({
      uri: 'https://slack.com/api/channels.info',
      qs: { token: process.env.TOKEN, channel: channelID },
      method: 'POST'
    }, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        console.log(body);
        return body;
      } else {
        console.error("Error");
        console.error(response);
        console.error(error);
        return error;
      }
    });
}

//////////////////////////
// Sending helpers
//////////////////////////
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",
            image_url: "http://messengerdemo.parseapp.com/img/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble"
            }]
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",
            image_url: "http://messengerdemo.parseapp.com/img/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble"
            }]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

// Set Express to listen out for HTTP requests
var server = app.listen(process.env.PORT || 3000, function () {
  console.log("Listening on port %s", server.address().port);
});
