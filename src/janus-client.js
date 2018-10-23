import Promise from 'bluebird';
import { Janus } from 'janus-videoroom-client';
import Boom from 'boom';

let Session = null;
const client = new Janus({
    url: 'ws://janus1:8188'
});

client.onConnected(() => {

    console.log('Janus is connected');

});
client.onDisconnected(() => {

    console.log('Janus is disconnected');

});
client.onError((err) => {

    console.error('Janus error', err);

});

client.onEvent((event) => {

    console.log('Janus onEvent', event);

});

export default () => client;

export const hashCode = (str) => {

    if (!str) return;
    const value = str.split('').reduce(
        (prevHash, currVal) => (((prevHash << 5) - prevHash) + currVal.charCodeAt(0))|0,
        0
    );
    return Math.abs(value, 10);

};

export const getSession = () => {

    if (Session === null) {

        return client
        .createSession()
        .then((handle) => {

            Session = createSession(handle);
            console.log(`SESSION created S[${Session.janusSession.id}]`);
            return Session;

        });

    }

    // console.log(`SESSION reattached S[${Session.janusSession.id}]`);
    return Promise.resolve(Session);

};

export const createVideoRoom = (options) => {

    return getSession()
    // attach videoroom plugin to this session
    .then(session => Promise.all([
        session.janusSession.videoRoom().defaultHandle(),
        session
    ]))
    .then(([videoRoomDefaultHandle, session]) => {

        // for information about rooms
        videoRoomDefaultHandle
        .list()
        .then((res) => {

            const existingRoomsIds = res.list.map(room => room.room);
            const availableRoom = res.list.filter(room => options.room === room.room);
            console.log(`A total of rooms ${res.list.length} exists (${existingRoomsIds}) current room are :`, availableRoom);
            return Promise.resolve;

        })
        .catch(() => {});

        return new Promise((resolve) => {

            if (options.room === undefined) return resolve(true);
            return videoRoomDefaultHandle
            .exists({ room: options.room })
            .then(({ exists }) => (exists ? resolve(false) : resolve(true)));

        })
        .then((createRoom) => {

            if (createRoom) {

                return videoRoomDefaultHandle.create(options)
                .then((res) => {

                    console.log(`ROOM created / S[${session.janusSession.id}] / H[${videoRoomDefaultHandle.id}] / R[${res.room}]`);
                    return res.room;

                });

            }
            return Promise.resolve(options.room);

        })
        .catch(interceptError);

    });

};

export const getVideoRoom = (_room) => {

    return getSession()
    // attach videoroom plugin to this session
    .then(session => Promise.all([
        session.janusSession.videoRoom().defaultHandle(),
        session
    ]))
    .then(([videoRoomDefaultHandle, session]) => {

        // console.log(`ATTACH Handle to session S[${session.janusSession.id}] H[${videoRoomDefaultHandle.id}]`);
        // broadcasting or private feed ? (Janus need integer room)

        const state = `/ S[${session.janusSession.id}] / H[${videoRoomDefaultHandle.id}] / R[${_room}]`;
        return {
            // remove a user from a room, and kill room if necessary
            detachUser: (_user) => {

                const publisher = session.getPublisher(_user);
                if (publisher && publisher.isEnded) {

                    publisher.handler.detach();
                    session.deletePublisher(_user);
                    console.log(`DETACH publisher ${state} / U[${_user}]`);

                }
                const subscriber = session.getSubscriber(_user);
                if (subscriber && subscriber.isEnded) {

                    subscriber.handler.detach();
                    session.deleteSubscriber(_user);
                    console.log(`DETACH subscriber ${state} / U[${_user}]`);

                }

                return videoRoomDefaultHandle
                .listParticipants({ room: _room })
                .then(({ participants }) => {

                    if (participants.length === 0) {

                        return videoRoomDefaultHandle
                        .exists({ room: _room })
                        .then(({ exists }) => (exists
                            ? videoRoomDefaultHandle.destroy({ room: _room })
                            : Promise.resolve))
                        .then(() => session.janusSession.destroy())
                        .then(() => {

                            deleteSession();
                            console.log(`DESTROY room and session ${state}`);

                        })

                    }

                    console.log(`DO NOT DESTROY room, there is ${participants.length} participants ${state}`);
                    return Promise.resolve;

                })
                .catch(interceptError);

            },
            publish: (_user, sdp) => {

                return session
                .janusSession
                .videoRoom()
                .publishFeed(_room, sdp)
                .then((handler) => {

                    session.addPublisher({
                        _user, handler, ended: false, _room
                    });
                    console.log(`STREAM published : ${state} / U[${_user}] (publisherId ${handler.publisherId})`);

                    handler.onWebrtcUp(() => {

                        const publisher = session.getPublisher(_user);
                        publisher.ended = true;
                        console.log(`RTC up and running ${state} / U[${_user}]`);

                    });

                    handler.onEvent((event) => {

                        console.log(`EVENT from publisher ${state} / U[${_user}]`, event);

                    });

                    handler.onDetached((e) => {

                        console.log(`onDetached from publisher ${state} / U[${_user}]`, e);

                    });

                    handler.onHangup((e) => {

                        console.log(`onHangup from publisher ${state} / U[${_user}]`, e);
                        session.deletePublisher(_user);
                        handler.detach();

                    });

                    // 1 trigger for video / 1 trigger for audio
                    handler.onMedia((response) => {

                        console.log(`MEDIA ${response.type} published ${state} / U[${_user}]`);

                    });

                    if (session.candidates[_user]) {

                        session.candidates[_user].forEach((ice) => {

                            handler
                            .trickle(ice)
                            .then((clientResponse) => {

                                const ack = clientResponse.response.janus === 'ack' ? 'OK' : 'OK';
                                console.log(`ICE received by Janus : ${ack} / ${_user} (after publisher create)`);

                            })
                            .catch(interceptError);

                        });

                        const isTrickleCompleted = session
                        .candidates[_user].find(ice => ice === null);
                        if (isTrickleCompleted) {

                            session.flushCandidates(_user);
                            handler
                            .trickleCompleted()
                            .then((clientResponse) => {

                                const ack = clientResponse.response.janus === 'ack' ? 'OK' : 'OK';
                                console.log(`ICE complete by Janus : ${ack} ${state} / U[${_user}] (after publisher create)`);

                            })
                            .catch(interceptError);

                        }

                    }
                    return handler;

                })
                .catch(interceptError);

            },
            doListenPublishers: (_users) => {

                const remotePublishers =
                    session.getRemotePublishers(_room, videoRoomDefaultHandle);

                return Promise.map(remotePublishers, remotePublisher =>

                    Promise.map(_users, _user =>

                        session
                        .janusSession
                        .videoRoom()
                        .listenFeed(_room, remotePublisher.id)
                        .then((handler) => {

                            console.log(`LISTEN received by Janus : ${state} / U[${_user}] attach to publisher ${remotePublisher.id}`);
                            handler.onEvent((event) => {

                                console.log(`EVENT from subscriber ${state} / U[${_user}]`, event);

                            });

                            // 1 trigger for video / 1 trigger for audio
                            handler.onMedia((response) => {

                                console.log(`MEDIA ${response.type} subscribed ${state} / U[${_user}]`);

                            });

                            handler.onHangup((e) => {

                                console.log(`onHangup from subscriber ${state} / U[${_user}]`, e);
                                session.deleteSubscriber(_user);
                                handler.detach();

                            });

                            session.addSubscriber({
                                _user, handler, ended: false, _room
                            });
                            return session.getSubscriber(_user);

                        })))
                .then(subscribers =>
                    subscribers.reduce((accumulator, current) => accumulator.concat(current)))
                .catch(interceptError);

            },
            sendAnswer: (_user, sdp) => {

                const subscriber = session.getSubscriber(_user);
                return subscriber
                .handler
                .setRemoteAnswer(sdp)
                .then(() => {

                    subscriber.isEnded = true;
                    console.log(`SDP answer received by Janus ${state} / U[${_user}]`);
                    return Promise.resolve();

                })
                .catch(interceptError);

            },
            sendCandidate: (_user, ice) => {

                console.log(`ICE received by RAPI : OK ${state} / U[${_user}]`);

                const publisher = session.getPublisher(_user);
                const subscriber = session.getSubscriber(_user);

                if (publisher && publisher.ended === false && ice === null) {

                    session.flushCandidates(_user);
                    publisher
                    .handler
                    .trickleCompleted()
                    .then((clientResponse) => {

                        const ack = clientResponse.response.janus === 'ack' ? 'OK' : 'OK';
                        console.log(`ICE complete by Janus : ${ack} ${state} / U[${_user}]`);

                    })
                    .catch(interceptError);

                } else if (publisher && publisher.ended === false) {

                    publisher
                    .handler
                    .trickle(ice)
                    .then((clientResponse) => {

                        const ack = clientResponse.response.janus === 'ack' ? 'OK' : 'OK';
                        console.log(`ICE received by Janus : ${ack} ${state} / U[${_user}]`);

                    })
                    .catch(interceptError);

                } else if (subscriber && subscriber.ended === false && ice === null) {

                    session.flushCandidates(_user);
                    subscriber
                    .handler
                    .trickleCompleted()
                    .then((clientResponse) => {

                        const ack = clientResponse.response.janus === 'ack' ? 'OK' : 'OK';
                        console.log(`ICE complete by Janus : ${ack} ${state} / U[${_user}]`);

                    })
                    .catch(interceptError);

                } else if (subscriber && subscriber.ended === false) {

                    subscriber
                    .handler
                    .trickle(ice)
                    .then((clientResponse) => {

                        const ack = clientResponse.response.janus === 'ack' ? 'OK' : 'OK';
                        console.log(`ICE received by Janus : ${ack} ${state} / U[${_user}]`);

                    })
                    .catch(interceptError);

                } else {

                    // persist ICE candidates because publisher/subscriber
                    // instance is not yet created
                    session.pushCandidates(_user, ice);

                }
                return Promise.resolve;

            }

        };

        // on crée une nouvelle room depuis l'instance du plugin
        // return videoRoomDefaultHandle.list().then((res) => {
        //
        //     const availableRoom = res.list.filter(room => videoRoomDefaultHandle.id === room.room);
        //     console.log(availableRoom);
        //
        // });

        // if (options) {
        //
        //     videoRoomDefaultHandle
        //     .configure(options)
        //     .then(() => expose);
        //
        // }

        // return Promise.delay(1000).then(() => expose);

    })
    .catch(interceptError);


};

function interceptError(err) {

    // try to reconnect in case Janus was down and has potentially been restarted
    if (Object.prototype.hasOwnProperty.call(err, 'name') && err.name === 'ConnectionStateError') {

        client.connect();
        return Promise.reject(Boom.gatewayTimeout());

    }

    console.error(err);

    return Promise.reject(err);

}

function deleteSession() {

    Session = null;

}

function createSession(janusSession) {

    const session = {
        janusSession,
        publishers: [],
        subscribers: [],
        candidates: {}
    };

    session.addPublisher = (publisher) => {

        if (!publisher._room) {

            throw new Error('_room is missing');

        }
        const sessionPublisher = session.getPublisher(publisher._user);
        if (sessionPublisher && sessionPublisher._room === publisher._room) {

            throw new Error('this publisher already exists');

        }
        session.publishers.push(publisher);

    };
    session.addSubscriber = (subscriber) => {

        if (!subscriber._room) {

            throw new Error('_room is missing');

        }
        const sessionSubscriber = session.getSubscriber(subscriber._user);
        if (sessionSubscriber && sessionSubscriber._room === subscriber._room) {

            throw new Error('this publisher already exists');

        }
        session.subscribers.push(subscriber);

    };
    session.getPublishersFromRoom = _room => session.publishers.filter(pb => pb._room === _room);
    session.getSubscribersFromRoom = _room => session.subscribers.filter(sb => sb._room === _room);
    session.getPublisher = _user => session.publishers.find(pb => pb._user === _user);
    session.getSubscriber = _user => session.subscribers.find(sb => sb._user === _user);
    session.deletePublisher = (_user) => {

        session.publishers = session.publishers.filter(sb => sb._user !== _user);

    };
    session.deleteSubscriber = (_user) => {

        session.subscribers = session.subscribers.filter(sb => sb._user !== _user);

    };
    session.flushCandidates = (_user) => {

        delete session.candidates[_user];

    };
    session.pushCandidates = (_user, ice) => {

        if (!session.candidates[_user]) {

            session.candidates[_user] = [];

        }
        session.candidates[_user].push(ice);

    };
    session.getRemotePublishers = (_room, handle) =>
        handle
        .listParticipants({ room: _room }).then((res) => {

            const publishers = session.getPublishersFromRoom(_room);
            const subscribers = session.getSubscribersFromRoom(_room);
            const remoteUsers = res.participants;
            const diffFromRemote = publishers.concat(subscribers).length - remoteUsers.length;
            console.log(`LIST remote participants, ${diffFromRemote} differences between remote and local session `);
            return remoteUsers;

        });
    return session;

}
