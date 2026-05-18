export type GenerateJob = {
  prospectId: string;
  templateId?: string;
  personaId?: string;
  campaignId?: string;
};

export type SendJob = {
  emailId: string;
};
