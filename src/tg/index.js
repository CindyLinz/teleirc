var Telegram = require('node-telegram-bot-api');
var config = require('../config');
var tgUtil = require('./util');
var logger = require('winston');
var M = require('../message');

var myUser = {};

var init = function(msgCallback) {
    // start HTTP server for media files if configured to do so
    if (config.showMedia) {
        tgUtil.initHttpServer();
    }

    var tg = new Telegram(config.tgToken, {polling: true});

    // get our own Telegram user
    tg.getMe().then(function(me) {
        myUser = me;

        tg.on('message', function(msg) {
            logger.debug('got tg msg:', msg);

            tgUtil.parseMsg(msg, myUser, tg, function(message) {
                if (message) {
                    var tgGroupReadOnly = message.channel.tgGroupReadOnly;
                    var isOverrideReadonly = message.channel.tgGroupOverrideReadOnly;
                    var isBotHighlighted = false;

                    isBotHighlighted = msg.text && msg.text.startsWith('@' + myUser.username);

                    if (tgGroupReadOnly) {
                        if (!(isOverrideReadonly && isBotHighlighted)) {
                            return;
                        }
                    }

                    message.original = msg;
                    message.protocol = 'tg';
                    msgCallback(message);
                }
            });
        });
    }).catch(function(err) {
      console.error(err);
    });

    return {
        send: function(message) {
            // if no chatId has been read for the chat yet, try reading it from disk
            if (!message.channel.tgChatId) {
                message.channel.tgChatId = tgUtil.readChatId(message.channel);
            }

            // if still no chatId, return with error message
            if (!message.channel.tgChatId) {
                var err = 'No chat_id set! Add me to a Telegram group ' +
                          'and say hi so I can find your group\'s chat_id!';

                msgCallback({
                    protocol: 'tg',
                    channel: message.channel,
                    text: err
                });

                logger.error(err);
                return;
            }

            var parseMode = config.parseMode;
            if (parseMode !== 'markdown' && parseMode !== 'html') {
                parseMode = undefined;
            }

            var textMessage;
            if (message.user) {
                var nick = '<' + message.user + '>';

                // save the message to fallback to plain text
                textMessage = nick + ' ' + message.text;

                if (config.emNick) {
                    if (parseMode === 'markdown') {
                        nick = '<*' + message.user + '*>';
                    }
                    if (parseMode === 'html') {
                        nick = '&lt;<b>' + message.user + '</b>&gt;';
                    }
                }

                message.text = nick + ' ' + message.text;

                if (parseMode === 'markdown') {
                    message.text = tgUtil.fixMarkdown(message.text);
                }
            }

            var r = M.get(message.replyTo);
            var replyId = (r && r.original && r.original.message_id) || undefined;

            if (replyId) {
                message.text = message.text.replace(M.ID_FORMAT, '');
            }

            logger.verbose('>> relaying to TG:', message.text);
            tg.sendMessage(
                message.channel.tgChatId,
                message.text,
                {
                    parse_mode: parseMode,
                    reply_to_message_id: replyId
                }
            )
                .catch(function(err) {
                    logger.error(err);
                    // resend
                    logger.verbose('>> fallback to plain text');
                    return tg.sendMessage(message.channel.tgChatId, textMessage);
                });
        }
    };
};

module.exports = init;
