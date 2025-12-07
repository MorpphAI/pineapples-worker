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
  status: string;       
  companyId: string;
  accommodationId: string;
  externalData: {
    reference: string;
  };
}

export interface AvantioAccommodation {
    id: string;  
    galleryId: string;
    name: string;        
    status: AccommodationStatus;
    
    area?: {
        livingSpace?: {
            amount: number; 
            unit: string;   
        };
    };
    
    location: AvantioLocation;
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

export interface AvantioResponse {
  data: AvantioBooking[];
  _links?: {
    next?: string;
  };
}