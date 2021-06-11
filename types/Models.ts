import {
  Medicince,
  Food,
  Ambulance,
  Oxygen,
  Bed,
  Therapy,
  Source,
  Type,
  BloodGroup,
} from "./Enums";

export interface IExtractedArrays {
  location?: string[];
  medicine?: Medicince[];
  food?: Food[];
  ambulance?: Ambulance[];
  oxygen?: Oxygen[];
  bed?: Bed[];
  therapy?: Therapy[];
  bloodgroup?: BloodGroup[];
}
export interface IInternalListingContact extends IContactMetaData {
  contactuid: string;
  leads?: ILead[];
  lastShared: number;
  verifiedviaportalinfo?: string;
  tags?: string;
}

export interface IListingContact
  extends IInternalListingContact,
    IExtractedArrays {}

interface IContactMetaData {
  type: Type;
  name?: string;
  verified?: string;
}

export interface ILeadMetaData {
  source: Source;
  senderId: string;
  blobfilename?: string;
  filename: string;
  debug?: string;
  timestamp: number;
}
export interface ExtractedContact
  extends IExtractedArrays,
    IContactMetaData,
    ILeadMetaData {
  contact: string[];
}

export interface ILead {
  leaduid: string;
  sender: string;
  source: Source;
  originTimestamp: number;
  link?: string;
  rawdata?: string;
}
