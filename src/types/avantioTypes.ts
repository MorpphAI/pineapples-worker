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

export interface AvantioResponse {
  data: AvantioBooking[];
  _links?: {
    next?: string;
  };
}


export interface Env {
	AVANTIO_API_KEY: string;
	AVANTIO_BASE_URL: string;
}