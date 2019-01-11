SITENAME = dtizzal.com

ship: 
	aws s3 cp . s3://${SITENAME} --recursive 