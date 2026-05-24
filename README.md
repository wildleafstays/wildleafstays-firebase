# Wildleaf Stays Clean Firebase

This is a fresh Firebase booking engine foundation. It does not depend on the old Railway backend.

## What This Build Uses

- Firebase Hosting for the customer website and admin panel
- Cloud Functions for all secure API work
- Firestore for properties, rooms, inventory, bookings, payments and admins
- Firebase Storage for property photos
- Firebase Auth for admin login
- Razorpay for payments

## Core Booking Rule

One physical property can be sold in two ways:

- Rooms mode: guests book room categories one by one.
- Full villa mode: guests book the whole physical property.

The villa is not a separate property. It uses the same rooms.

When a room booking is confirmed, Firestore daily inventory is updated for each night. If even one room is booked, full villa availability becomes false for those dates.

When a full villa booking is confirmed, all room categories are blocked for those dates.

This check and update happens inside one Firestore transaction in `functions/src/bookings.js`, so two guests cannot confirm the same inventory at the same time.

## Firestore Shape

```text
properties/{propertyId}
  name
  destination
  destinationKey
  sellAsFullVilla
  fullVillaPrice
  status
  photos[]
  amenities[]

properties/{propertyId}/roomCategories/{roomCategoryId}
  name
  totalRooms
  basePrice
  active

properties/{propertyId}/dailyInventory/{yyyy-mm-dd}
  villaBooked
  roomCategories.{roomCategoryId}.totalRooms
  roomCategories.{roomCategoryId}.bookedRooms
  roomCategories.{roomCategoryId}.availableRooms
  bookingIds[]

bookings/{bookingId}
  propertyId
  bookingType: rooms | fullVilla
  checkIn
  checkOut
  guest
  rooms[]
  bookingStatus
  paymentStatus
  totalAmount

payments/{paymentId}

adminUsers/{uid}
```

## Important Files

- `functions/src/inventory.js`: shared availability and blocking logic
- `functions/src/bookings.js`: booking hold, confirm and cancel transactions
- `functions/src/payments.js`: Razorpay order and payment verification
- `functions/src/admin.js`: admin setup and property/room APIs
- `frontend/customer`: customer booking website
- `frontend/admin`: simple admin starter

## Next Practical Steps

1. Add a Firebase Web App in the Firebase console.
2. Copy its config into `frontend/admin/admin.js`.
3. Set Firebase secrets:

```powershell
npx.cmd firebase-tools functions:secrets:set RAZORPAY_KEY_ID
npx.cmd firebase-tools functions:secrets:set RAZORPAY_KEY_SECRET
npx.cmd firebase-tools functions:secrets:set ADMIN_SETUP_KEY
```

4. Deploy:

```powershell
npx.cmd firebase-tools deploy
```

5. Create the first admin by calling `/api/admin/setup` with your setup key.
