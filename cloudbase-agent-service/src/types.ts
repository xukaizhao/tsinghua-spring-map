export type PlannerIntent = {
  rawQuery: string;
  sceneId: string;
  durationMinutes?: number;
  preferredSpecies?: string[];
  preferredColor?: "pink" | "white" | "yellow";
  wantsLunch?: boolean;
  wantsPhoto?: boolean;
  wantsShade?: boolean;
  wantsRest?: boolean;
  targetPoiName?: string;
};

export type RouteStop = {
  id?: string;
  name: string;
  reason: string;
  lat?: number;
  lng?: number;
  tags?: string[];
  species?: string[];
  plants?: string;
  images?: string[];
  stayMinutes?: number;
  photoScore?: number;
  bloomScore?: number;
  shadeScore?: number;
  restScore?: number;
};

export type RouteSegment = {
  title: string;
  objective: string;
  travelMode: "walking";
  durationText: string;
  distanceText?: string;
  stops: RouteStop[];
};

export type ToolCallTrace = {
  tool: string;
  purpose: string;
};

export type PoiSelectionDebug = {
  phase: "start" | "lunch" | "target";
  query: string;
  anchorName?: string;
  mode: "llm" | "heuristic";
  chosenName?: string;
  chosenReason?: string;
  rawResponse?: string;
  error?: string;
  candidates: Array<{
    name: string;
    address?: string;
    distanceMeters?: number;
    category?: string;
  }>;
};

export type RoutePlanCard = {
  type: "route_plan";
  sceneId: string;
  userIntent: string;
  routeTitle?: string;
  summary: string;
  decisionTrace: string[];
  toolCalls: ToolCallTrace[];
  segments: RouteSegment[];
  totalDistanceKm?: number;
  totalDurationMin?: number;
  insights?: {
    needs: string[];
    reasons: string[];
    suggestions: string[];
  };
  mapOverlays?: {
    markers?: Array<{ name: string; lat?: number; lng?: number }>;
    polylines?: Array<{ label: string; coordinates: Array<{ lat: number; lng: number }> }>;
  };
  debug?: {
    agent: {
      llmConfigured: boolean;
      llmModel?: string;
      llmBaseUrl?: string;
      strategy: "llm+tools" | "rules+tools";
      mapProvider?: "tencent" | "baidu";
      mapProviderLabel?: string;
    };
    taskRouter: {
      used: boolean;
      mode: "llm" | "heuristic";
      input: {
        query: string;
        startPoint?: string;
        sceneId: string;
      };
      output: {
        tasks: string[];
        searches: Array<{
          purpose: string;
          keywords: string[];
          around: string;
          radiusMeters: number;
          reason: string;
        }>;
        reasoning: string[];
      };
      rawResponse?: string;
      error?: string;
    };
    resolutions?: {
      start?: {
        query?: string;
        resolvedName?: string;
        resolvedBy?: string;
      };
      target?: {
        query?: string;
        resolvedName?: string;
        resolvedBy?: string;
      };
      lunch?: {
        query?: string;
        resolvedName?: string;
        resolvedBy?: string;
      };
    };
    poiSelections?: PoiSelectionDebug[];
  };
};
