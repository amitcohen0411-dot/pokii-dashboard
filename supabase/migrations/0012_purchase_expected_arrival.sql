-- Direct (non-forwarder) purchases had no "when is this coming" field at
-- all — forwarder_shipments already has expected_arrival_date for the
-- forwarder->user leg, but a purchase shipped straight to the user had
-- nothing equivalent. Populated from Vinted's own "Order update for {item}:
-- your order is on its way! Estimated delivery is {start} - {end}" emails
-- (store the later/end date, a safe "should have it by" bound) — this is
-- more reliable than DHL's own delivery-notification emails, which confirm
-- *a* parcel is arriving/delivered but never say which item, so they can't
-- be matched to a specific purchase.
alter table purchases add column expected_arrival_date date;
