// Public metadata for stable edit links; never includes private drafts or attachments.
hexo.extend.generator.register('studio-manifest',function(locals){
  const posts=Object.fromEntries(locals.posts.toArray().map(post=>['source/'+post.source,'/'+post.path]));
  return [
    {path:'content-manifest.json',data:JSON.stringify({posts})},
    {path:'revision.json',data:JSON.stringify({commit:process.env.GITHUB_SHA || 'local',generated:new Date().toISOString()})}
  ];
});
