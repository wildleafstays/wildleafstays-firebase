# Wildleaf Stays Firebase Migration

This branch prepares the site for Firebase Hosting, Cloud Functions, Firestore, and Razorpay.

## What Firebase Will Run

- `frontend/` is served by Firebase Hosting.
- `/api/**` is rewritten to the Cloud Function named `api`.
- Firestore stores hotels, rooms, bookings, payments, admins, homepage content, and inventory.
- Razorpay order creation and payment verification run only inside Cloud Functions.

## Required Firebase Secrets

Set these before deploying Functions:

```bash
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set JWT_SECRET
firebase functions:secrets:set ADMIN_SETUP_KEY
```

Use Razorpay test keys while testing. The secret key must never be placed in frontend JavaScript.

## First Firestore Collections

- `hotels`
- `hotels/{hotelId}/rooms`
- `bookings`
- `admins`
- `payments`
- `homepageSections`
- `branding`
- `headerMenu`

The first migrated endpoints are the public hotel list/detail, inventory read, website booking creation, Razorpay order creation, payment verification, admin creation, admin login, and booking list.

The old Railway backend remains in `backend/` for reference while the remaining admin and content APIs are migrated.

