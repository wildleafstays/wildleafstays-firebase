const { stayDates } = require("./dates");
const { money } = require("./money");

async function getPropertyBundle(db, propertyId) {
  const propertyRef = db.collection("properties").doc(String(propertyId));
  const propertyDoc = await propertyRef.get();

  if (!propertyDoc.exists) {
    return null;
  }

  const roomSnap = await propertyRef.collection("roomCategories")
    .where("active", "==", true)
    .get();

  const roomCategories = {};
  roomSnap.forEach(doc => {
    roomCategories[doc.id] = {
      id: doc.id,
      ...doc.data()
    };
  });

  return {
    propertyRef,
    property: { id: propertyDoc.id, ...propertyDoc.data() },
    roomCategories
  };
}

function buildBlankInventory(date, roomCategories) {
  const categoryInventory = {};

  Object.entries(roomCategories).forEach(([id, room]) => {
    const totalRooms = Number(room.totalRooms || 0);
    categoryInventory[id] = {
      totalRooms,
      bookedRooms: 0,
      availableRooms: totalRooms,
      price: money(room.basePrice),
      manuallyClosed: false
    };
  });

  return {
    date,
    villaBooked: false,
    roomCategories: categoryInventory,
    bookingIds: [],
    updatedAt: null
  };
}

async function readInventoryForDates(transaction, propertyRef, dates, roomCategories) {
  const docs = [];

  for (const date of dates) {
    const ref = propertyRef.collection("dailyInventory").doc(date);
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() : buildBlankInventory(date, roomCategories);
    docs.push({ date, ref, data });
  }

  return docs;
}

function countTotalRooms(roomCategories) {
  return Object.values(roomCategories).reduce((sum, room) => sum + Number(room.totalRooms || 0), 0);
}

function countBookedRooms(dayInventory) {
  return Object.values(dayInventory.roomCategories || {})
    .reduce((sum, item) => sum + Number(item.bookedRooms || 0), 0);
}

function villaAvailable(dayInventory, roomCategories) {
  if (dayInventory.villaBooked === true) return false;
  return countBookedRooms(dayInventory) === 0 && countTotalRooms(roomCategories) > 0;
}

function roomAvailable(dayInventory, roomCategoryId, quantity) {
  if (dayInventory.villaBooked === true) return false;
  const item = dayInventory.roomCategories?.[roomCategoryId];
  return item && Number(item.availableRooms || 0) >= Number(quantity || 0);
}

function quoteRooms(roomCategories, rooms, dates) {
  let subtotal = 0;
  let gstAmount = 0;
  const lines = [];

  rooms.forEach(item => {
    const room = roomCategories[item.roomCategoryId];
    if (!room) return;

    const quantity = Number(item.quantity || 0);
    const adults = Number(item.adults || 0);
    const kids = Number(item.kids || 0);
    const maxGuests = Number(room.maxGuests || room.maxGuestsPerRoom || 2) * quantity;
    if (quantity < 1) return;
    if (adults + kids > maxGuests) {
      throw new Error(`${room.name} allows maximum ${maxGuests} guests for ${quantity} room(s)`);
    }
    const includedGuests = Number(room.includedGuests || maxGuests) * quantity;
    const chargeableGuests = Math.max(adults + kids - includedGuests, 0);
    const extraAdultRate = money(room.extraAdultRate || 0);
    const extraKidRate = money(room.extraKidRate || 0);
    const chargeableAdults = Math.min(chargeableGuests, adults);
    const chargeableKids = Math.max(chargeableGuests - chargeableAdults, 0);
    const base = money(room.basePrice) * quantity * dates.length;
    const extra = money((chargeableAdults * extraAdultRate + chargeableKids * extraKidRate) * dates.length);
    const taxable = base + extra;
    const gst = money(taxable * Number(room.gstPercent || 0) / 100);

    subtotal += taxable;
    gstAmount += gst;
    lines.push({
      roomCategoryId: item.roomCategoryId,
      name: room.name,
      quantity,
      adults,
      kids,
      infants: Number(item.infants || 0),
      maxGuests,
      baseAmount: money(base),
      extraGuestAmount: money(extra),
      gstAmount: money(gst),
      totalAmount: money(taxable + gst)
    });
  });

  return {
    lines,
    subtotal: money(subtotal),
    gstAmount: money(gstAmount),
    totalAmount: money(subtotal + gstAmount)
  };
}

function quoteVilla(property, roomCategories, dates) {
  const nightlyTotal = Object.values(roomCategories || {}).reduce((sum, room) => {
    return sum + money(room.basePrice) * Number(room.totalRooms || 0);
  }, 0);
  const subtotal = money(nightlyTotal) * dates.length;
  const gstAmount = money(subtotal * Number(property.fullVillaGstPercent || 0) / 100);

  return {
    nightlyTotal: money(nightlyTotal),
    subtotal: money(subtotal),
    gstAmount,
    totalAmount: money(subtotal + gstAmount)
  };
}

function applyRoomBooking(dayInventory, rooms, bookingId) {
  rooms.forEach(item => {
    const category = dayInventory.roomCategories[item.roomCategoryId];
    const quantity = Number(item.quantity || 0);

    category.bookedRooms = Number(category.bookedRooms || 0) + quantity;
    category.availableRooms = Math.max(Number(category.availableRooms || 0) - quantity, 0);
  });

  dayInventory.bookingIds = [...new Set([...(dayInventory.bookingIds || []), bookingId])];
  return dayInventory;
}

function applyVillaBooking(dayInventory, bookingId) {
  dayInventory.villaBooked = true;

  Object.values(dayInventory.roomCategories || {}).forEach(category => {
    category.bookedRooms = Number(category.totalRooms || 0);
    category.availableRooms = 0;
  });

  dayInventory.bookingIds = [...new Set([...(dayInventory.bookingIds || []), bookingId])];
  return dayInventory;
}

function releaseBooking(dayInventory, booking) {
  if (booking.bookingType === "fullVilla") {
    dayInventory.villaBooked = false;
    Object.values(dayInventory.roomCategories || {}).forEach(category => {
      category.bookedRooms = 0;
      category.availableRooms = Number(category.totalRooms || 0);
    });
  } else {
    (booking.rooms || []).forEach(item => {
      const category = dayInventory.roomCategories[item.roomCategoryId];
      if (!category) return;

      const quantity = Number(item.quantity || 0);
      category.bookedRooms = Math.max(Number(category.bookedRooms || 0) - quantity, 0);
      category.availableRooms = Math.min(
        Number(category.availableRooms || 0) + quantity,
        Number(category.totalRooms || 0)
      );
    });
  }

  dayInventory.bookingIds = (dayInventory.bookingIds || []).filter(id => id !== booking.id);
  return dayInventory;
}

module.exports = {
  getPropertyBundle,
  buildBlankInventory,
  readInventoryForDates,
  villaAvailable,
  roomAvailable,
  quoteRooms,
  quoteVilla,
  applyRoomBooking,
  applyVillaBooking,
  releaseBooking,
  stayDates
};
