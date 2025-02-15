/*
 * Copyright 2017, OpenRemote Inc.
 *
 * See the CONTRIBUTORS.txt file in the distribution for a
 * full listing of individual contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
package org.openremote.manager.event;

import org.apache.camel.Exchange;
import org.apache.camel.Message;
import org.apache.camel.impl.DefaultMessage;
import org.openremote.container.timer.TimerService;
import org.openremote.container.web.ConnectionConstants;
import org.openremote.model.event.TriggeredEventSubscription;
import org.openremote.model.event.shared.CancelEventSubscription;
import org.openremote.model.event.shared.EventSubscription;
import org.openremote.model.event.shared.SharedEvent;
import org.openremote.model.util.TextUtil;

import java.util.*;
import java.util.logging.Logger;

/**
 * Manages subscriptions to events for WebSocket sessions.
 */
public class EventSubscriptions {

    private static final Logger LOG = Logger.getLogger(EventSubscriptions.class.getName());

    final protected TimerService timerService;
    final protected Map<String, SessionSubscriptions> sessionSubscriptionIdMap = new HashMap<>();

    class SessionSubscriptions extends HashSet<SessionSubscription> {
        public void createOrUpdate(boolean restrictedUser, EventSubscription<?> eventSubscription) {

            if (TextUtil.isNullOrEmpty(eventSubscription.getSubscriptionId())) {
                cancelByType(eventSubscription.getEventType());
            } else {
                cancelById(eventSubscription.getSubscriptionId());
            }

            add(new SessionSubscription(restrictedUser, timerService.getCurrentTimeMillis(), eventSubscription));
        }

        public void update(boolean resstrictedUser, String[] subscriptionIds) {
            List<String> ids = Arrays.asList(subscriptionIds);
            forEach(sessionSubscription -> {
                if (ids.contains(sessionSubscription.subscriptionId)) {
                    sessionSubscription.restrictedUser = resstrictedUser;
                    sessionSubscription.timestamp = timerService.getCurrentTimeMillis();
                }
            });
        }

        public void cancelByType(String eventType) {
            removeIf(sessionSubscription -> sessionSubscription.subscriptionId == null && sessionSubscription.subscription.getEventType().equals(eventType));
        }

        public void cancelById(String subscriptionId) {
            removeIf(sessionSubscription -> sessionSubscription.subscription.getSubscriptionId().equals(subscriptionId));
        }
    }

    class SessionSubscription {
        boolean restrictedUser;
        long timestamp;
        final EventSubscription subscription;
        final String subscriptionId;

        public SessionSubscription(boolean restrictedUser, long timestamp, EventSubscription subscription) {
            this.restrictedUser = restrictedUser;
            this.timestamp = timestamp;
            this.subscription = subscription;
            this.subscriptionId = subscription.getSubscriptionId();
        }

        public boolean matches(boolean accessibleForRestrictedUsers, SharedEvent event) {
            return (!restrictedUser || accessibleForRestrictedUsers) && subscription.getEventType().equals(event.getEventType());
        }
    }

    public EventSubscriptions(TimerService timerService) {
        LOG.info("Starting background task checking for expired event subscriptions from clients");
        this.timerService = timerService;
    }

    public void createOrUpdate(String sessionKey, boolean restrictedUser, EventSubscription<?> subscription) {
        synchronized (this.sessionSubscriptionIdMap) {
            // TODO Check if the user can actually subscribe to the events it wants, how do we do that?
            LOG.finer("For session '" + sessionKey + "', creating/updating: " + subscription);
            SessionSubscriptions sessionSubscriptions =
                this.sessionSubscriptionIdMap.computeIfAbsent(sessionKey, k -> new SessionSubscriptions());
            sessionSubscriptions.createOrUpdate(restrictedUser, subscription);
        }
    }

    public void update(String sessionKey, boolean restrictedUser, String[] subscriptionIds) {
        synchronized (this.sessionSubscriptionIdMap) {
            SessionSubscriptions sessionSubscriptions = this.sessionSubscriptionIdMap.get(sessionKey);
            if (sessionSubscriptions != null) {
                LOG.finer("For session '" + sessionKey + "', updating: " + Arrays.toString(subscriptionIds));
                sessionSubscriptions.update(restrictedUser, subscriptionIds);
            }
        }
    }

    public void cancel(String sessionKey, CancelEventSubscription subscription) {
        synchronized (this.sessionSubscriptionIdMap) {
            if (!this.sessionSubscriptionIdMap.containsKey(sessionKey)) {
                return;
            }
            if (subscription.getEventType() == null && subscription.getSubscriptionId() == null) {
                return;
            }
            LOG.finer("For session '" + sessionKey + "', cancelling: " + subscription);
            SessionSubscriptions sessionSubscriptions = this.sessionSubscriptionIdMap.get(sessionKey);
            if (!TextUtil.isNullOrEmpty(subscription.getSubscriptionId())) {
                sessionSubscriptions.cancelById(subscription.getSubscriptionId());
            } else {
                sessionSubscriptions.cancelByType(subscription.getEventType());
            }
            if (sessionSubscriptions.isEmpty()) {
                this.sessionSubscriptionIdMap.remove(sessionKey);
            }
        }
    }

    public void cancelAll(String sessionKey) {
        synchronized (this.sessionSubscriptionIdMap) {
            if (this.sessionSubscriptionIdMap.containsKey(sessionKey)) {
                LOG.finer("Cancelling all subscriptions for session: " + sessionKey);
                this.sessionSubscriptionIdMap.remove(sessionKey);
            }
        }
    }

    @SuppressWarnings("unchecked")
    public <T extends SharedEvent> List<Message> splitForSubscribers(Exchange exchange) {
        List<Message> messageList = new ArrayList<>();
        SharedEvent event = exchange.getIn().getBody(SharedEvent.class);
        if (event == null)
            return messageList;

        boolean accessibleForRestrictedUsers = exchange.getIn().getHeader(ClientEventService.HEADER_ACCESS_RESTRICTED, false, Boolean.class);

        Set<Map.Entry<String, SessionSubscriptions>> sessionSubscriptionsSet;
        synchronized (this.sessionSubscriptionIdMap) {
            sessionSubscriptionsSet = new HashSet<>(sessionSubscriptionIdMap.entrySet());
        }

        for (Map.Entry<String, SessionSubscriptions> entry : sessionSubscriptionsSet) {
            String sessionKey = entry.getKey();
            SessionSubscriptions subscriptions = entry.getValue();

            for (SessionSubscription sessionSubscription : subscriptions) {

                if (!sessionSubscription.matches(accessibleForRestrictedUsers, event))
                    continue;

                if (sessionSubscription.subscription.getFilter() == null
                    || sessionSubscription.subscription.getFilter().apply(event)) {
                    LOG.finer("Creating message for subscribed session '" + sessionKey + "': " + event);
                    List<SharedEvent> events = Collections.singletonList(event);
                    TriggeredEventSubscription<?> triggeredEventSubscription = new TriggeredEventSubscription<>(events, sessionSubscription.subscriptionId);

                    if (sessionSubscription.subscription.getInternalConsumer() == null) {
                        Message msg = new DefaultMessage();
                        msg.setBody(triggeredEventSubscription); // Don't copy the event, use same reference
                        msg.setHeaders(new HashMap<>(exchange.getIn().getHeaders())); // Copy headers
                        msg.setHeader(ConnectionConstants.SESSION_KEY, sessionKey);
                        messageList.add(msg);
                    } else {
                        if (triggeredEventSubscription.getEvents() != null) {
                            triggeredEventSubscription.getEvents().forEach(ev ->
                                sessionSubscription.subscription.getInternalConsumer().accept(ev));
                        }
                    }
                }
            }
        }
        return messageList;
    }
}
