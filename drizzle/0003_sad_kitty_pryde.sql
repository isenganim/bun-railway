ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "wishlists" DROP CONSTRAINT "wishlists_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "wishlists" DROP CONSTRAINT "wishlists_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_discount_value_check" CHECK (("coupons"."discount_type" = 'percentage' AND "coupons"."discount_value" > 0 AND "coupons"."discount_value" <= 100) OR ("coupons"."discount_type" = 'fixed' AND "coupons"."discount_value" > 0));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_min_order_amount_check" CHECK ("coupons"."min_order_amount" >= 0);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_usage_check" CHECK ("coupons"."current_usage" >= 0 AND ("coupons"."max_usage" IS NULL OR "coupons"."max_usage" >= "coupons"."current_usage"));