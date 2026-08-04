export interface AvantioExternalData {
  reference: string;
  type?: unknown;
  category?: unknown;
  kind?: unknown;
  [key: string]: unknown;
}

export interface AvantioBooking {
  id: string;
  id1: string;
  reference: string;
  creationDate: string; 
  createdAt: string;    
  updatedAt: string;    
  stayDates: {
    arrival: string;    
    departure: string;  
  };
  arrivalTime?: string;
  departureTime?: string;
  checkInTime?: string;
  checkOutTime?: string;
  expectedArrivalTime?: string;
  expectedDepartureTime?: string;
  plannedArrivalTime?: string;
  plannedDepartureTime?: string;
  status: string;       
  companyId: string;
  accommodationId: string;
  externalData: AvantioExternalData;
  guest?: unknown;
  guests?: unknown;
  client?: unknown;
  customer?: unknown;
  tenant?: unknown;
  holder?: unknown;
  occupancy?: unknown;
  adults?: unknown;
  children?: unknown;
  babies?: unknown;
  guestsNumber?: unknown;
  numberOfGuests?: unknown;
  price?: unknown;
  totalPrice?: unknown;
  amount?: unknown;
  totalAmount?: unknown;
  value?: unknown;
  comments?: unknown;
  comment?: unknown;
  notes?: unknown;
  note?: unknown;
  description?: unknown;
  bookingType?: unknown;
  reservationType?: unknown;
  type?: unknown;
  category?: unknown;
  kind?: unknown;
  source?: unknown;
  channel?: unknown;
  [key: string]: unknown;
}

export interface AvantioAccommodation {
    id: string;  
    galleryId: string;
    name: string;        
    status: AccommodationStatus;
    externalReference?: string;
    registryData?: {
        registerReference?: string;
        [key: string]: unknown;
    };
    
    area?: {
        livingSpace?: {
            amount: number; 
            unit: string;   
        };
    };
    
    location: AvantioLocation;
    [key: string]: unknown;
}

export interface AvantioLocation {
    countryCode: string;
    cityName: string;
    postalCode: string;
    addrType: string;
    address: string;
    number: string;
    resort?: string;
    door?: string;       
    coordinates?: {
        lat: string;
        lon: string;
    };
}

export enum BookingStatus {
    CONFIRMED = 'CONFIRMED',
    PAID = 'PAID',
    OWNER = 'OWNER',
    UNPAID = 'UNPAID'
}

export enum AccommodationStatus {
    DISABLED = 'DISABLED',
    ENABLED = 'ENABLED' 
}

export interface AvantioResponse<T = AvantioBooking> {
  data: T[];
  _links?: {
    next?: string;
  };
}
