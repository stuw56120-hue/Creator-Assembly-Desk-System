import { z } from "zod";

const AnchorPointSchema = z.enum([
  "top_left",
  "top_center",
  "top_right",
  "center_left",
  "center",
  "center_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
]);

const AnimationTypeSchema = z.enum([
  "fade",
  "slide_up",
  "slide_down",
  "slide_left",
  "slide_right",
  "wipe_right",
  "wipe_left",
  "scale",
]);

const EasingTypeSchema = z.enum([
  "linear",
  "ease_in",
  "ease_out",
  "ease_in_out",
  "bounce",
]);

const BannerTemplateSchema = z.enum([
  "lower_third",
  "title_card",
  "corner_badge",
  "full_width_bar",
]);

const DetectionSourceSchema = z.enum([
  "semantic_similarity",
  "silence_gap",
  "gpt_editorial",
  "speaker_transition",
]);

export const BannerEventSchema = z.object({
  type: z.literal("motion_overlay"),
  template: BannerTemplateSchema,
  time: z.string().regex(/^\d{2}:\d{2}:\d{2}\.\d{3}$/, "Must be HH:MM:SS.mmm"),
  duration: z.number().positive(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  position: z.object({
    anchor: AnchorPointSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  }),
  animation: z.object({
    in: AnimationTypeSchema,
    hold: z.literal("static"),
    out: AnimationTypeSchema,
    easing: EasingTypeSchema,
  }),
  style: z.object({
    theme: z.string().min(1),
    opacity: z.number().min(0).max(1),
    accent_colour: z.string().min(1),
    border_radius: z.number().min(0),
    shadow: z.boolean(),
    shadow_blur: z.number().min(0).optional(),
  }),
  layer: z.number().int().min(0),
  user_editable: z.boolean(),
  detection_source: DetectionSourceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  detection_profile: z.string().optional(),
  render_context: z
    .object({
      resolution: z.string(),
      scale_factor: z.number().positive(),
    })
    .optional(),
  review_required: z.boolean().optional(),
});

export type BannerEvent = z.infer<typeof BannerEventSchema>;
