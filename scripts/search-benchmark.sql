-- Run only against an isolated test database. All synthetic records are rolled back.
\set ON_ERROR_STOP on
BEGIN;
WITH owner AS (
 INSERT INTO users(id,email,password_hash,first_name,last_name,role)
 VALUES(gen_random_uuid(),'benchmark-' || gen_random_uuid() || '@example.test','not-a-login-hash','Benchmark','Agent','agent') RETURNING id
)
INSERT INTO properties(id,agent_id,title,slug,description,listing_type,property_type,price,bedrooms,bathrooms,state_id,city_id,area_id,address,status,created_at)
SELECT gen_random_uuid(),owner.id,'Benchmark family home ' || n,'benchmark-' || gen_random_uuid(),'A modern family home with a garden and natural light.','sale','house',1000000+n*10000,(n%5)+1,3,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Benchmark address','active',now()-n*interval '1 minute'
FROM owner CROSS JOIN generate_series(1,50000) n;
INSERT INTO property_images(id,property_id,url,position,is_cover)
SELECT gen_random_uuid(),id,'https://example.test/property.jpg',0,true FROM properties WHERE title LIKE 'Benchmark family home %';
ANALYZE properties;
ANALYZE property_images;
EXPLAIN (ANALYZE,BUFFERS)
SELECT jsonb_build_object('id',p.id,'title',p.title,'slug',p.slug,'price',p.price,'listing_type',p.listing_type,'property_type',p.property_type,'rental_period',p.rental_period,'bedrooms',p.bedrooms,'bathrooms',p.bathrooms,'size_sqm',p.size_sqm,'status',p.status,'is_verified',p.is_verified,'created_at',p.created_at,'city',c.name,'state',s.name,'area',a.name,'cover_image',(SELECT url FROM property_images WHERE property_id=p.id ORDER BY is_cover DESC,position LIMIT 1)) FROM properties p JOIN cities c ON c.id=p.city_id JOIN states s ON s.id=p.state_id LEFT JOIN areas a ON a.id=p.area_id WHERE p.status='active' ORDER BY p.created_at DESC,p.id DESC LIMIT 21;
EXPLAIN (ANALYZE,BUFFERS)
SELECT jsonb_build_object('id',p.id,'title',p.title,'slug',p.slug,'price',p.price,'listing_type',p.listing_type,'property_type',p.property_type,'rental_period',p.rental_period,'bedrooms',p.bedrooms,'bathrooms',p.bathrooms,'size_sqm',p.size_sqm,'status',p.status,'is_verified',p.is_verified,'created_at',p.created_at,'city',c.name,'state',s.name,'area',a.name,'cover_image',(SELECT url FROM property_images WHERE property_id=p.id ORDER BY is_cover DESC,position LIMIT 1)) FROM properties p JOIN cities c ON c.id=p.city_id JOIN states s ON s.id=p.state_id LEFT JOIN areas a ON a.id=p.area_id WHERE p.status='active' AND p.city_id='20000000-0000-4000-8000-000000000001' AND p.listing_type='sale' AND p.price BETWEEN 50000000 AND 150000000 ORDER BY p.price,p.id LIMIT 21;
ROLLBACK;
