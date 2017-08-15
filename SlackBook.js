//
// This is main file containing code implementing the Express server and functionality for the Express echo bot.
//
//TODO
//Add support for images
'use strict';
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const emoji_js = require('emoji-js');
//const path = require('path');
require('dotenv').config();
var Datastore = require('nedb');
var emoji = new emoji_js.EmojiConvertor();
emoji.init_env();
emoji.replace_mode = 'unified';
var messengerButton = "<html><head><title>Facebook Messenger Bot</title></head><body><h1>Facebook Messenger Bot</h1>This is a bot based on Messenger Platform QuickStart. For more details, see their <a href=\"https://developers.facebook.com/docs/messenger-platform/guides/quick-start\">docs</a>.<script src=\"https://button.glitch.me/button.js\" data-style=\"glitch\"></script><div class=\"glitchButton\" style=\"position:fixed;top:20px;right:20px;\"></div></body></html>";

// The rest of the code implements the routes for our Express server.
var app = express();
var groups = new Datastore({ filename: 'groups.json', autoload: true });
var userLogins = new Datastore({ filename: 'userLogins.json', autoload: true });
var userSettings = new Datastore({ filename: 'userSettings.json', autoload: true });

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
//Facebook webhook validation
app.get('/facebook', function(req, res) {
	if (req.query['hub.mode'] === 'subscribe' &&
	req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
		console.log("Validating Facebook webhook");
		res.status(200).send(req.query['hub.challenge']);
	}
	else {
		console.error("Failed Facebook validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
});

//Catches POST requests from Facebook and responds to them
app.post('/facebook', function (req, res) {
	//console.log(req.body);
	let data = req.body;
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

//Preconditions: event is a Facebook API event containing text from a Facebook user
//Postconditions: the message received will be processed and replied to
function receivedMessage(event) {
	let senderID = event.sender.id;
	//var recipientID = event.recipient.id;
	//var timeOfMessage = event.timestamp;
	let message = event.message;
	//var messageId = message.mid;
	let messageText = message.text;
	//var messageAttachments = message.attachments;
	console.log("Received Facebook message from " + senderID + ": " + messageText);
	if (messageText) {
		userLogins.findOne( { FB_ID: senderID }, function(err, doc){
			//make sure the user has at least one slack account linked to their facebook account
			//if they don't, send them a sign in link
			if( doc === null ){
				console.error(senderID + " is not signed into any Slack accounts.")
				sendTextMessage(senderID, "You must sign in with at least one Slack account");
				SignIn(senderID);
			//if the message starts with "/signin", send them a sign in link
			} else if( messageText.substring(0,7) === "/signin" ){
				console.log(senderID + " requested a sign in link.")
				SignIn(senderID);
			//if the message starts with "/signout", prompt to find which team the user wants to sign out of
			} else if( messageText.substring(0,8) === "/signout" ){
				//go to the signout part of the condition below
				PromptTeams(senderID, "signout");
			//if the message starts with "/subscribe", prompt to get the team of the channel to which the user wants to subscribe
			} else if( messageText.substring(0,10) === "/subscribe"){
				//go to the subscribe part of the condition below
				PromptTeams(senderID, "subscribe");
			//if the message starts with "/unsubscribe", prompt to get the team of hte channel to which the users wants to unsubscribe
			} else if( messageText.substring(0,12) === "/unsubscribe"){
				//go to the unsubscribe part of the condition below
				PromptTeams(senderID, "unsubscribe");
			//if the message starts with "/select", prompt to find the team the user wants to select
			} else if(messageText.substring(0,7) === "/select"){
				//go to the select part of the condition below
				PromptTeams(senderID, "select");
			//if the message is a quick reply, process the payload
			} else if(message.quick_reply != undefined){
				//the payload is a string with pieces of information separated by "~_!", so split the payload by that string to get an array of information
				let payload = message.quick_reply.payload.split("~_!");
				//if the user was previously entered "/subscribe", prompt to get the channel to which the user wants to subscribe
				if(payload[0] === "subscribe"){
					let teamName = payload[1];
					PromptAllChannels(senderID, teamName);
				//if the user previously chose a channel to which to subscribe, update the database with the new subscription
				} else if(payload[0] === "subscribe2"){
					let teamID = payload[1];
					let teamName = payload[2];
					let channelID = payload[3];
					let channelName = payload[4];
					SubscribeUpdateDatabase(senderID, teamID, teamName, channelID, channelName);
				//if the user previously entered "/unsubscribe", prompt to get the channel to which the user wants to unsubscribe
				} else if(payload[0] === "unsubscribe"){
					let teamName = payload[1]
					PromptSubscribedChannels(senderID, teamName, "unsubscribe2");
				//if the user previously chose a channel to which to unsubscribe, update the database with the new changes
				} else if(payload[0] === "unsubscribe2"){
					let teamName = payload[1];
					let channelName = payload[2];
					Unsubscribe(teamName, channelName, senderID);
				//if the user previously entered "/signout", update the database with the new changes
				} else if(payload[0] === "signout"){
					let teamName = payload[1]
					SignOut(senderID, teamName);
				//if the user previously entered "/select", prompt to find the channel the user wants to select
				} else if(payload[0] === "select"){
					let teamName = payload[1];
					PromptSubscribedChannels(senderID, teamName, "select2");
				//if the user previously entered a channel to select, update the database with user's selected team and channel
				} else if(payload[0] === "select2"){
					let teamName = payload[1];
					let channelName = payload[2];
					SelectTeamChannel(senderID, teamName, channelName);
				}
			//if the message isn't one of the above formats, assume the user wants to send a message
			} else{
				//get the team name, channel name, and message from the facebook message
				let colon = messageText.indexOf(":");
				let space = messageText.indexOf(" ", colon);
				let teamName = null;
				let channelName = null;
				let message = null;
				//if the user doesn't specify the channel and team, get his/her selected team and channel
				if(colon === -1 || space === -1){
					userSettings.findOne( {FB_ID: senderID}, function(err, doc){
						teamName = doc.SELECTED_TEAM;
						channelName = doc.SELECTED_CHANNEL;
						message = messageText;
						sendSlackMessage(senderID, teamName, channelName, message);
					});
				//otherwise, parse the message for them and send the message based on them
				} else {
					teamName = messageText.substring(0, colon);
					channelName = messageText.substring(colon+1, space);
					message = messageText.substring(space+1);
					sendSlackMessage(senderID, teamName, channelName, message);
				}
			}
		} );
	}
}

//Postback event
function receivedPostback(event) {
	let senderID = event.sender.id;
	let recipientID = event.recipient.id;
	let timeOfPostback = event.timestamp;
	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages.
	let payload = event.postback.payload;
	console.log("Received postback for user %d and page %d with payload '%s' " +
	"at %d", senderID, recipientID, payload, timeOfPostback);
	// When a postback is called, we'll send a message back to the sender to
	// let them know it was successful
	sendTextMessage(senderID, "Postback called");
}

//Preconditions: recipientID is the Facebook ID of the user who will receive the sign in button
//Postconditions: the user will be sent a link to sign into Slack
function SignIn(recipientId){
	let messageData = {
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
							url:"https://slack.com/oauth/authorize?scope=channels:history,channels:read,chat:write:user,groups:history,groups:read,team:read,users:read&client_id=" + process.env.SLACK_CLIENT_ID + "&state=" + recipientId,
							title:"Sign In"
						}
					]
				}
			}
		}
	};
	callSendAPI(messageData);
}

//Preconditions: fbID is a valid Facebook ID
//				teamName is a team the user is currently signed into
//Postconditions: The user's auth token is revoked and the database document is removed
function SignOut(fbID, teamName){
	userLogins.findOne( { $and: [ {FB_ID: fbID}, {SLACK_TEAM_NAME: teamName} ] }, function(err, doc){
		//stop if the user is not signed into the team
		if(doc === null){
			console.error(fbID + " is not signed into team " + teamName);
			sendTextMessage(fbID, "You are not signed into this team.");
			return;
		}
		//revoke the user's auth token
		request({
			uri: "https://slack.com/api/auth.revoke",
			qs: {
				token: doc.SLACK_TOKEN,
				exclude_members: "true"
			},
			method: "POST"
		}, (error, response, body) => {
			let JSONresponse = JSON.parse(body);
			if(!JSONresponse.ok){
				console.error("Error when logging user " + fbID + " out of team " + teamName + ".");
				console.error("Error: " + error);
				console.error("Response: " + response);
				console.error("Body: " + body);
				sendTextMessage(fbID, "Sorry, we encountered an error while processing this request.");
				return;
			}
			//remove the user's login document
			userLogins.remove( { $and: [ {FB_ID: fbID}, {SLACK_TEAM_NAME: teamName} ] }, {}, function (){} );
			//if that was the only team the user was logged into, delete the user's settings document
			userLogins.count({ FB_ID: fbID }, function (err, count) {
				if(count === 0){
					userSettings.remove( {FB_ID: fbID}, {}, function (){} );
				}
			});
			//remove the user's subscription from all channels of the team
			groups.update( {TEAM_NAME: teamName}, { $pull: {USERS: fbID} }, {}, function (){} );
			console.log("Successfully logged user " + fbID + " out of team " + teamName + ".");
			sendTextMessage(fbID, "You are now logged out of team " + teamName + ".");
		});
	});
}

//Preconditions: fbID is a valid Facebook ID
//				nextFunction is the next function that will be executed in the condition
//Postconditions: sends fbID a message with each team they are signed into as a quick reply
function PromptTeams(fbID, nextFunction){
	userLogins.find( {FB_ID: fbID}, function(err, doc){
		//make sure the user is logged into at least one team
		if(doc === null){
			console.error(fbID + " is not signed into any teams.");
			sendTextMessage(fbID, "You are not signed into any teams.");
			return;
		}
		//go through each of the user's logins, and add each team as a quick reply button
		let quickReplyButtons = [];
		doc.forEach(function(login){
			quickReplyButtons.push({
				"content_type" : "text",
				"title" : login.SLACK_TEAM_NAME,
				"payload" : nextFunction + "~_!" + login.SLACK_TEAM_NAME
			});
		});
		//build the message and send it to the user
		let messageData = {
			"recipient":{
				"id": fbID
			},
			"message":{
				"text":"Pick a team:",
				"quick_replies": quickReplyButtons
			}
		}
		callSendAPI(messageData);
	});
}

function PromptAllChannels(fbID, teamName){
	userLogins.findOne( { $and: [ {FB_ID: fbID}, {SLACK_TEAM_NAME: teamName} ] }, function(err, doc){
		//stop if the user is not signed into the team
		if(doc === null){
			console.error(fbID + " is not signed into team " + teamName);
			sendTextMessage(fbID, "You are not signed into this team.");
			return;
		}
		let teamID = doc.SLACK_TEAM_ID;
		//Get channel ID
		request({
			uri: "https://slack.com/api/channels.list",
			qs: {
				token: doc.SLACK_TOKEN,
				exclude_members: "true"
			},
			method: "POST"
		}, (error, response, body) => {
			let JSONresponse = JSON.parse(body);
			if(!JSONresponse.ok){
				console.error("Error when getting list of channels from " + teamName + ".");
				console.error("Error: " + error);
				console.error("Response: " + response);
				console.error("Body: " + body);
				sendTextMessage(fbID, "Sorry, we encountered an error while processing this request.");
				return;
			}
			let channels = JSONresponse.channels;
			let quickReplyButtons = [];
			channels.forEach(function(channel){
				quickReplyButtons.push({
					"content_type" : "text",
					"title" : channel.name,
					"payload" : "subscribe2~_!" + teamID + "~_!" + teamName + "~_!" + channel.id + "~_!" + channel.name
				});
			});
			request({
				uri: "https://slack.com/api/groups.list",
				qs: {
					token: doc.SLACK_TOKEN,
					exclude_members: "true"
				},
				method: "POST"
			}, (error, response, body) => {
				let JSONresponse = JSON.parse(body);
				if(!JSONresponse.ok){
					console.error("Error when getting list of groups from " + teamName + ".");
					console.error("Error: " + error);
					console.error("Response: " + response);
					console.error("Body: " + body);
					sendTextMessage(fbID, "Sorry, we encountered an error while processing this request.");
					return;
				}
				let slackGroups = JSONresponse.groups;
				slackGroups.forEach(function(slackGroup){
					quickReplyButtons.push({
						"content_type" : "text",
						"title" : slackGroup.name,
						"payload" : "subscribe2~_!" + teamID + "~_!" + teamName + "~_!"  + slackGroup.id + "~_!" + slackGroup.name
					});
				});
				let messageData = {
					"recipient":{
						"id": fbID
					},
					"message":{
						"text":"Pick a channel:",
						"quick_replies": quickReplyButtons
					}
				}
				callSendAPI(messageData);
			});
		});
	});
}

function PromptSubscribedChannels(fbID, teamName, nextFunction){
	groups.find( { $and: [ {TEAM_NAME: teamName}, {USERS: fbID} ] }, function(err, doc){
		if(doc === null){
			console.error(fbID + " is not subscribed to any teams from team " + teamName);
			sendTextMessage(fbID, "You are not subscribed to any channels from this team.");
			return;
		}
		let quickReplyButtons = [];
		doc.forEach(function(group){
			quickReplyButtons.push({
				"content_type" : "text",
				"title" : group.CHANNEL_NAME,
				"payload" : nextFunction + "~_!" + group.TEAM_NAME + "~_!"  + group.CHANNEL_NAME
			});
		});
		let messageData = {
			"recipient":{
				"id": fbID
			},
			"message":{
				"text":"Pick a channel:",
				"quick_replies": quickReplyButtons
			}
		}
		callSendAPI(messageData);
	});
}

//Preconditions: channelName is a channel of team teamName
//              teamName is a team the user is signed into
//              fbID is the Facebook ID of the user who wants to subscibe to channelName
//Postconditions: the user is subscribed to channelName by adding their fbID to the appropriate database entry
function Unsubscribe(teamName, channelName, fbID){
	console.log("Attempting to unsubscribe " + fbID + " to channel " + channelName + " of team " + teamName + ".");
	//Get team ID
	groups.findOne( { $and: [ {TEAM_NAME: teamName}, {CHANNEL_NAME: channelName} ] }, function(err, doc){
		//stop if the user is not signed into the team
		if(doc === null){
			console.error(fbID + " is not subscribed to channel " + channelName + " of team " + teamName);
			sendTextMessage(fbID, "You are not subscribed to channel " + channelName + " of team " + teamName);
			return;
		}
		console.log("Removing " + fbID + " from exisitng database entry.");
		groups.update( { $and: [ {TEAM_NAME: teamName}, {CHANNEL_NAME: channelName} ] },
			{ $pull: {USERS: fbID} }, {returnUpdatedDocs: true}, function (err, numAffected, updatedDoc){
				if(updatedDoc.USERS.length === 0){
				groups.remove( { $and: [ {TEAM_NAME: teamName}, {CHANNEL_NAME: channelName} ] }, {}, function (){} );
				}
		} );
			sendTextMessage(fbID, "You are now unsubscribed from channel " + channelName + " in team " + teamName);
	} );
}

function SubscribeUpdateDatabase(fbID, teamID, teamName, channelID, channelName){
	groups.findOne( { $and: [ {TEAM_ID: teamID}, {CHANNEL_ID: channelID} ] }, function(err, doc){
		//if there no users yet subscribed to the channel, create a new database entry
		if(doc === null){
			console.log("No one is subscribed to channel " + channelName + " in team " + teamName + ", creating new database entry.");
			groups.insert( {
				TEAM_ID: teamID,
				TEAM_NAME: teamName,
				CHANNEL_ID: channelID,
				CHANNEL_NAME: channelName,
				USERS: [fbID]
			}, function(){} );
		} else{
			//otherwise, add the user to the existing entry
			console.log("Adding " + fbID + " to exisitng database entry.");
			groups.update( { $and: [ {TEAM_ID: teamID}, {CHANNEL_ID: channelID} ] },
				{ $addToSet: { USERS: fbID } }, {}, function (){} );
		}
		SelectTeamChannel(fbID, teamName, channelName);
		sendTextMessage(fbID, "You are now subscribed to channel " + channelName + " in team " + teamName);
	} );
}

function SelectTeamChannel(senderID, teamName, channelName){
	userSettings.update({FB_ID: senderID}, {$set: {SELECTED_TEAM: teamName, SELECTED_CHANNEL: channelName}});
	console.log(senderID + " selected channel " + channelName + " in team " + teamName);
	sendTextMessage(senderID, "You have selected channel " + channelName + " in team " + teamName);
}

function sendSlackMessage(senderID, teamName, channelName, message){
	console.log(senderID + " is trying to send message to channel " + channelName + " of team " + teamName + ".");
	console.log("Message: " + message);
	if(teamName === "" || channelName === ""){
		console.error(senderID + " has not selected a team or channel.");
		sendTextMessage(senderID, "You have not selected a team or channel. Use \"/select\" to select a team and channel.");
		return;
	}
	userLogins.findOne( { $and: [ {FB_ID: senderID}, {SLACK_TEAM_NAME: teamName} ] }, function(err, doc){
		let token = 0;
		//stop if the user is not signed into the team
		if(doc === null){
			console.error(senderID + " is not signed into team " + teamName);
			sendTextMessage(senderID, "You are not signed into " + teamName + ".");
			return;
		}
		token = doc.SLACK_TOKEN;
		//get the channel id
		groups.findOne( { $and: [ {TEAM_NAME: teamName}, {CHANNEL_NAME: channelName} ] }, function(err, doc2){
			//stop if the channel does not exist
			if(doc2 === null){
				console.error("Channel " + channelName + " in team " + teamName + " does not exist.");
				sendTextMessage(senderID, "Channel " + channelName + " in team " + teamName + " does not exist.");
				return;
			}
			userSettings.update( {FB_ID: senderID}, {$set : {SELECTED_TEAM: teamName, SELECTED_CHANNEL: channelName, LAST_FB_MESSAGE: message}} );
			let channelID = doc2.CHANNEL_ID;
			//post the message to Slack
			request({
				uri: 'https://slack.com/api/chat.postMessage',
				qs: {
					token: token,
					channel: channelID,
					text: message,
					as_user: true
				},
				method: 'POST'
			}, function (error, response, body) {
				let JSONresponse = JSON.parse(body);
				if (!JSONresponse.ok){
					console.error("Unable to send message from " + senderID + " to channel " + channelName + " of team " + teamName + ".");
					console.error("Error while sending message from " + senderID + " to channel " + channelName + " of team " + teamName + ".");
					console.error("Error: " + error);
					console.error("Response: " + response);
					console.error("Body: " + body);
					sendTextMessage(senderID, "Sorry, we encountered an error while sending this message.");
					return;
				}
				console.log("Successfully sent message.");
			});
		} );
	} );
}

//Preconditions: recipientID is the Facebook ID of the user to recieve the messageText
//              messageText is the message the user will recieve
//Postconditions: the message will be built and sent to Facebook's API for delivery
function sendTextMessage(recipientId, messageText) {
	let messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: messageText
		}
	};

	callSendAPI(messageData);
}

//Preconditions: messageData is a prebuilt message to be sent to facebook
//Postconditions: message data will be sent to Facebook's API
function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: { access_token: process.env.PAGE_ACCESS_TOKEN },
		method: 'POST',
		json: messageData
	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			let recipientId = body.recipient_id;
			console.log("Successfully sent Facebook message to " + recipientId);
			console.log("Message: " + JSON.stringify(messageData));
		} else {
			console.error("Unable to send Facebook message.");
			console.error("Error: " + error);
			console.error("Response: " + response);
			console.error("Body: " + body);
		}
	});
}




//---------------------------------
//   Slack Side
//---------------------------------
//Catches POST events from Slack
app.post('/slack', function(req, res) {
	//if Slack is verifying the url, respond appropriately
	if (req.body.type === 'url_verification') {
		console.log("Validating Slack events");
		res.status(200).send(req.body.challenge);
	//Check if the event is a message posted to a channel
	} else if(req.body.event.type === 'message') {
		res.sendStatus(200);
		let teamID = req.body.team_id;
		let channelID = req.body.event.channel;
		let slackID = req.body.event.user;
		let message = req.body.event.text;
		message = message.replace(/:[A-Za-z0-9-_+]+:/g, function(match){
			return emoji.replace_colons(match);
		});
		message = message.replace(/&amp;/g, "&");
		message = message.replace(/&lt;/g, "<");
		message = message.replace(/&gt;/g, ">");
		console.log("Message posted to channel " + channelID + " of team " + teamID + ".");
		console.log("Message: " + message);
		//If the message is from a channel rename, update the database
		if(req.body.event.subtype === "channel_name"){
			let newName = req.body.event.name;
			console.log("Channel " + channelID + " has been renamed to " + newName + ".");
			groups.update( { $and: [ {TEAM_ID: teamID}, {CHANNEL_ID: channelID} ] },
				{ $set: { CHANNEL_NAME: newName } }, {}, function (){} );
			}
			//Notify channel subscribers
			//Get the team and channel name
			groups.findOne( { $and: [ {TEAM_ID: teamID}, {CHANNEL_ID: channelID} ] }, function(err, doc){
				//Stop if there are no users subscribed to the channel
				if(doc === null){
					console.log("No one is subscribed to messages from this channel.");
					return;
				}
				//otherwise, get an access token from one of the subscribers
				let teamName = doc.TEAM_NAME;
				let channelName = doc.CHANNEL_NAME;
				userLogins.findOne( { $and: [ {FB_ID: doc.USERS[0]}, {SLACK_TEAM_ID: teamID} ] }, function(err, doc2){
					if(doc2 === null){
						console.error("The user and group databases must be out of sync.");
						return;
					}
					let token = doc2.SLACK_TOKEN;
					//use the access token to get the name of the Slack user who posted the message
					request({
						uri: "https://slack.com/api/users.info",
						qs: {
							token: token,
							user: slackID
						},
						method: "POST"
					}, (error, response, body) => {
						var JSONresponse = JSON.parse(body);
						if(!JSONresponse.ok){
							console.error("Unable to notify Facebook users about Slack message.")
							console.error("Error while getting information about user " + slackID + " from team " + teamName + ".");
							console.error("Error: " + error);
							console.error("Response: " + response);
							console.error("Body: " + body);
							return;
						}
						let userName = JSONresponse.user.name;
						//get the FAcebook ID of the sender
						let fbID = 0;
						userLogins.findOne( { $and: [ {SLACK_ID: slackID}, {SLACK_TEAM_ID: teamID} ] }, function(err, doc3){
							if(doc3 != null){
								fbID = doc3.FB_ID;
							}
							let lastFBMessage = "";
							userSettings.findOne( {FB_ID: fbID }, function(err, doc4){
								if(doc4 != null){
									lastFBMessage = doc4.LAST_FB_MESSAGE;
								}
								console.log("Sending message to channel subscribers.");
								let fromSlack = lastFBMessage != message;
								doc.USERS.forEach(function(user){
									if(user != fbID || fromSlack){
										sendTextMessage(user, teamName + "|" + channelName + "\n" + userName + ": " + message);
									}
								});
							});
							//Send a message to each of the channel subscribers, except the user who posted the message
						});
					});
				} );
			} );
		//if the event was a team renaming, update the database
		} else if(req.body.event.type === "team_rename"){
			res.sendStatus(200);
			let teamID = req.body.team_id;
			let newName = req.body.event.name;
			console.log("Team " + teamID + " was renamed to " + newName);
			userLogins.update( {SLACK_TEAM_ID: teamID},
				{ $set: { SLACK_TEAM_NAME: newName } }, {}, function (){} );
			groups.update( {TEAM_ID: teamID},
				{ $set: { TEAM_NAME: newName } }, {}, function (){} );
		//if the event was a user renaming, update the database
		} else if(req.body.event.type === "user_change"){
					res.sendStatus(200);
					let slackID = req.body.event.user.id;
					let newName = req.body.event.user.name;
					console.log("User " + slackID + "'s name is now " + newName);
					userLogins.update( {SLACK_ID: slackID},
						{ $set: { SLACK_NAME: newName } }, {}, function (){} );
		}
});

//Catches Slack sign-ins and processes them
app.get('/auth/redirect', function(req, res) {
	//respond to Slack's auth request
	request({
		uri: 'https://slack.com/api/oauth.access?code='
		+req.query.code+
		'&client_id='+process.env.SLACK_CLIENT_ID+
		'&client_secret='+process.env.SLACK_CLIENT_SECRET,
		method: 'GET'
	}, (error, response, body) => {
		let JSONresponse = JSON.parse(body);
		let fbID = req.query.state;
		//stop if something wen't wrong
		if (!JSONresponse.ok){
			res.send("Error encountered: \n"+JSON.stringify(JSONresponse)).status(200).end();
			console.error("Unable to sign user " + fbID + " into team.")
			console.error("Error while trying obtain access token for user " + fbID + ".");
			console.error("Error: " + error);
			console.error("Response: " + response);
			console.error("Body: " + body);
			sendTextMessage(fbID, "Sorry, we encountered an error while processing this request.");
			return;
		}
		//otherwise, process the response, get the user's name and the team's name, and update the database
		let slackID = JSONresponse.user_id;
		let token = JSONresponse.access_token;
		let teamID = JSONresponse.team_id;
		let teamName = JSONresponse.team_name;
		console.log("Signing " + fbID + " into team " + teamID + ".");
		//get the user's name
		request({
			uri: "https://slack.com/api/users.info",
			qs: {
				token: token,
				user: slackID
			},
			method: "POST"
		}, (error, response, body) => {
			let JSONresponse2 = JSON.parse(body);
			if (!JSONresponse2.ok){
				console.log("Unable to sign user " + fbID + " into team " + teamID + ".")
				console.log("Error while getting information about user " + slackID + " from team " + teamID + ".");
				console.log("Error: " + error);
				console.log("Response: " + response);
				console.log("Body: " + body);
				sendTextMessage(fbID, "Sorry, we encountered an error while processing this request.");
				return;
			}
			let name = JSONresponse2.user.name;
				userLogins.findOne( { $and: [ {FB_ID: fbID}, {SLACK_TEAM_ID: teamID} ] }, function(err, doc){
					//if the user is not signed into the team, update the database
					if(doc === null){
						userLogins.insert( {
							FB_ID: fbID,
							SLACK_ID: slackID,
							SLACK_NAME: name,
							SLACK_TOKEN: token,
							SLACK_TEAM_ID: teamID,
							SLACK_TEAM_NAME: teamName
						}, function(){} );
						userSettings.insert( {
							FB_ID: fbID,
							SELECTED_TEAM: "",
							SELECTED_CHANNEL: "",
							LAST_FB_MESSAGE: ""
						})
						console.log(fbID + " is now signed into team " + teamName);
						sendTextMessage(fbID, "You are now signed into " + teamName + ".")
					//otherwise, do nothing
					} else{
						console.error(fbID + " is already signed into " + teamName);
						sendTextMessage(fbID, "You are already signed into " + teamName + ".")
						return;
					}
				} );
			});
		});
		res.send("Success!");
	//})
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
	let messageData = {
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
//Subscribe("general", "joestestinggrounds", "1312082588902702");
