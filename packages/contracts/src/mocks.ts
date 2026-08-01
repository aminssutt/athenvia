import type { ProgramDetail, ProgramSummary, SearchResponse, WatchlistResponse } from "./schemas";

export const mockProgram: ProgramSummary = {
  id: "0f043d91-d700-4ee1-8f66-9a65c7e59301",
  university: {
    id: "c9502eb6-819b-4723-9a17-d503555eaead",
    name: "National University of Singapore",
    countryCode: "SG",
    city: "Singapore",
    logoUrl: null,
  },
  name: "MSc Venture Creation",
  degreeType: "MASTER",
  domains: ["Entrepreneurship", "Management"],
  location: "Singapore",
  durationMonths: 12,
  intakeLabel: "August 2027",
  nextWindow: {
    id: "79a514c7-1211-4a21-8b09-2f2807947001",
    roundName: null,
    opensAt: null,
    closesAt: null,
    publicStatus: "NOT_PUBLISHED",
    officialSourceUrl: "https://nus.edu.sg/",
  },
};

export const mockProgramDetail: ProgramDetail = {
  ...mockProgram,
  summary: {
    text: "A graduate programme focused on building and launching new ventures through multidisciplinary coursework, practical projects and structured mentorship.",
    officialSourceUrl: "https://nus.edu.sg/",
  },
  intakes: [
    {
      id: "6a3828b7-4852-4f29-90cd-99b74348f652",
      label: mockProgram.intakeLabel,
    },
  ],
};

export const mockSearchResponse: SearchResponse = {
  programs: [mockProgram],
  universities: [
    {
      id: "c9502eb6-819b-4723-9a17-d503555eaead",
      name: "National University of Singapore",
      countryCode: "SG",
      city: "Singapore",
      officialWebsite: "https://nus.edu.sg/",
      programCount: 1,
    },
  ],
  nextCursor: null,
};

export const mockWatchlistResponse: WatchlistResponse = {
  watching: [
    {
      id: "444ff389-c858-4a8d-8777-1da17276496d",
      trackingStatus: "WATCHING",
      program: mockProgram,
      nextUsefulDate: null,
    },
  ],
  openNow: [],
  applied: [],
};
