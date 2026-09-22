BEGIN;
INSERT INTO wm.predicate(predicate_key,description,subject_kinds,value_type,cardinality,unit,value_schema) VALUES
('person.display_name','人物采用的姓名',ARRAY['PERSON'],'STRING','SINGLE',NULL,'{"type":"string","minLength":1}'),
('person.height','身高测量；scope_key=测量来源标识',ARRAY['PERSON'],'NUMBER','MULTI','cm','{"type":"number","exclusiveMinimum":0}'),
('person.contact','联系方式；scope_key=联系方式种类和实例',ARRAY['PERSON'],'OBJECT','MULTI',NULL,'{"type":"object","required":["kind","value"],"properties":{"kind":{"type":"string"},"value":{"type":"string"}},"additionalProperties":false}'),
('person.member_of','组织关系；scope_key=关系实例',ARRAY['PERSON'],'ENTITY','MULTI',NULL,'{"type":"string","format":"uuid"}'),
('preference.statement','长期偏好，非权限描述',ARRAY['PERSON'],'STRING','MULTI',NULL,'{"type":"string"}'),
('goal.statement','长期目标',ARRAY['GOAL'],'STRING','SINGLE',NULL,'{"type":"string"}'),
('project.constraint','项目约束及出处；不作为执行授权',ARRAY['PROJECT'],'STRING','MULTI',NULL,'{"type":"string"}'),
('resource.location','资源位置',ARRAY['DEVICE','SERVICE','RESOURCE','PROJECT'],'STRING','SINGLE',NULL,'{"type":"string"}'),
('resource.depends_on','依赖关系',ARRAY['DEVICE','SERVICE','RESOURCE','PROJECT'],'ENTITY','MULTI',NULL,'{"type":"string","format":"uuid"}'),
('resource.observed_state','最近已知状态；来源及时间必留',ARRAY['DEVICE','SERVICE','RESOURCE'],'OBJECT','SINGLE',NULL,'{"type":"object","required":["state"],"properties":{"state":{"type":"string"}},"additionalProperties":false}');
COMMIT;
